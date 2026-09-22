# Business OS — Current Project Map

> Purpose: give any developer or AI agent a fast, accurate map of the repository before changing code.
>
> Verified against `main` at `41345619013dd936454a53a293f67bf06233a032` on 2026-09-22.
>
> This file describes the **current truth**, not an idealized future architecture. Known transitional debt is called out explicitly.

## 1. Product and architecture in one minute

Business OS is a multi-tenant SaaS operating system for companies, currently **Real Estate First**.

The governing product principle is:

**AI Executes, Human Decides.**

The intended dependency direction is:

```text
Browser / UI
    ↓
Next.js server actions / route handlers
    ↓
@business-os/core domain services
    ↓
@business-os/database
    ↓
PostgreSQL with FORCE RLS + composite tenant-safe foreign keys
```

The architectural target is a **Modular Monolith**: one deployable product with strong internal domain boundaries, not a collection of prematurely separated microservices.

## 2. The commercial model

The most important domain distinction is:

```text
Lead
  ↓  one person may have many
Opportunity
  ↓  optional execution linkage
Reservation
  ↓
Contract
```

### Lead = the person / customer relationship

A Lead answers: **Who are we working with?**

Examples of Lead-owned concerns:

- name, phone, email
- source and campaign relationship
- assignee
- activities and contact history
- follow-up tasks
- relationship / qualification lifecycle

Current canonical Lead statuses:

`NEW → CONTACTED → QUALIFIED → MEETING_SCHEDULED → SITE_VISIT_BOOKED → RESERVED → CONTRACTED`

Terminal compatibility states also include `UNQUALIFIED` and `LOST`.

Important: some later Lead statuses are still compatibility milestones while Opportunity migration is in progress. They must not become the long-term forecast source of truth.

### Opportunity = the commercial deal

An Opportunity answers: **What specific deal are we trying to close with this Lead?**

One Lead may have multiple Opportunities.

Current Opportunity stages:

`DISCOVERY → PROPOSAL → NEGOTIATION → WON / LOST`

The application domain name is **Opportunity**. The physical PostgreSQL table is still named `deals` for backward compatibility.

### Reservation = temporary inventory hold

A Reservation answers: **Which Unit is currently being held, for which Lead, and until when?**

A Reservation may optionally reference an Opportunity through `opportunity_id`.

Historical Reservations are allowed to keep `opportunity_id = NULL` when the correct Opportunity cannot be proven.

### Contract = executed commercial record

A Contract answers: **What agreement was actually created for the Lead and Unit?**

A Contract may optionally reference an Opportunity. When a Contract is created from a Reservation that already has an Opportunity, it inherits that Opportunity.

No historical Reservation or Contract may be linked to an Opportunity by guessing from Lead alone.

## 3. Domain ownership

- **CRM** — owns Leads, Lead lifecycle, Tasks, Activities, and customer/contact history. Primary code: `packages/core/src/crm`. Lead creation and stage transitions must use the shared lifecycle primitives.
- **Sales** — owns Opportunities and forecast-pipeline behavior. Primary code: `packages/core/src/sales`. `opportunity-service.ts` is authoritative; legacy Deal APIs delegate here.
- **Real Estate** — owns Projects, Units, taxonomy, visits, payment plans, Reservations, and Contracts. Primary code: `packages/core/src/real-estate`. Real Estate may point to Sales Opportunities; Sales must not depend on Real Estate.
- **Permissions** — owns RBAC, row-level application authorization, and tenant-member guards. Primary code: `packages/core/src/permissions`. UI permission checks are convenience only; security boundaries belong in Core + Database.
- **Automation** — owns Smart Rules, rule execution, time scanners, and outbox logic. Primary code: `packages/core/src/rules`. Automations must call invariant-preserving domain services instead of mutating business entities directly.
- **Integrations** — owns Meta, WhatsApp, credentials, and external ingestion. Primary code: `packages/core/src/integrations` and `packages/core/src/whatsapp`. External Lead creation must enter through canonical Lead creation.
- **Analytics** — owns dashboards and attribution. Primary code: `packages/core/src/analytics`. Forecast and realized revenue sources are different; see Section 5.
- **AI** — owns knowledge, retrieval, Ask Your Business, and AI builder capabilities. Primary code: `packages/core/src/ai`. AI operates inside permission and tenant boundaries; human approval remains the product rule.

### Transitional ownership debt

These files are not yet in their ideal boundary:

- `packages/core/src/crm/lead-property-interest-service.ts` is physically under CRM, but Property Interest is Real Estate-specific domain data.
- `packages/core/src/views/read-models.ts` still contains multiple domains and matching logic.
- `packages/types/src/entities.ts` still mixes many domains in one large shared file.
- shared transaction/audit infrastructure is still partly located under CRM.
- the root `@business-os/core` barrel exports all domains, so compile-time module boundaries remain weak.
- `apps/web/lib/auth.ts` still imports `@business-os/database` directly for a user lookup. The desired direction is presentation → core → database.

Do not silently “fix” these while implementing an unrelated feature. Refactor them in explicit, behavior-preserving slices.

## 4. Source of Truth table

- **Tenant membership and role:** `organization_memberships` plus verified tenant context. Never trust a client-provided role or organization ID.
- **Customer relationship:** `leads`. Opportunity or Contract is not a substitute for the person/customer record.
- **Lead lifecycle/history:** the shared Lead lifecycle service plus `lead_stage_history`. Do not directly `UPDATE leads.status`.
- **Forecast deal:** Opportunity, physically stored in `deals`. Do not use Lead status as the forecast deal.
- **Forecast stage:** `deals.stage` through the Sales Opportunity service. Reservation status is not a substitute.
- **Forecast value:** Opportunity `value`. Contract revenue is a different truth.
- **Inventory state:** `units.status` plus Reservation/Contract invariants. Do not rely on UI-local state.
- **Temporary hold:** `reservations`. Opportunity stage is not a hold record.
- **Actual executed sale / revenue:** executed `contracts`. Opportunity value is forecast, not realized revenue.
- **Marketing realized-revenue attribution:** Contract-backed attribution. Lead counts and Opportunity value are not realized revenue.
- **Permissions:** Core permission engine plus PostgreSQL RLS. Hidden buttons are not authorization.
- **Tenant isolation:** PostgreSQL FORCE RLS plus composite foreign keys. Application filtering alone is insufficient.

## 5. Analytics truth and current transition

Target business semantics:

- **Forecast Pipeline Value** = open Opportunities.
- **Realized Revenue** = executed Contracts.
- **Marketing Revenue Attribution** = Contract-backed.

Current code is still transitional:

1. `getExecutiveDashboard()` calculates pipeline value from `deals`, but currently filters only `stage != 'LOST'`. That means `WON` is still included. The target model should treat only open stages (`DISCOVERY`, `PROPOSAL`, `NEGOTIATION`) as forecast.
2. Contract creation treats `SIGNED` and `ACTIVE` as executed states, while current dashboard/attribution queries primarily count `SIGNED` Contracts.
3. Reservation / Contract linkage does **not yet** advance Opportunity lifecycle automatically.

These are known transition points. Do not hide them in documentation, and do not change them opportunistically inside unrelated work.

## 6. Database and multi-tenancy rules

The system uses one PostgreSQL database with a shared schema.

Every tenant-aware operation must preserve the zero-leak invariant:

**Organization A must never view, mutate, reference, or infer Organization B data.**

Required layers:

1. `withTenantContext(organizationId, ...)`
2. runtime least-privilege role `app_user`
3. PostgreSQL `ENABLE ROW LEVEL SECURITY`
4. PostgreSQL `FORCE ROW LEVEL SECURITY`
5. tenant-scoped policies using `app.current_tenant_id`
6. composite foreign keys containing `organization_id`

R1.3B additionally enforces Opportunity linkage at the relational layer:

- Reservation Opportunity must belong to the same Tenant + Lead.
- Contract Opportunity must belong to the same Tenant + Lead.
- when Contract has both Reservation and Opportunity, they must represent the same linkage.

Never weaken these checks for convenience.

## 7. Where to put changes

### Business logic

Put domain behavior in `packages/core/src/<domain>`.

Do not put business rules in React components, server actions, or raw route handlers.

### Database changes

Migrations live in:

`packages/database/migrations`

Rules:

- migrations are append-only;
- never edit an already-run migration;
- use a new numbered migration;
- unknown old data stays unknown;
- no fabricated backfills.

### Shared types

Shared schemas and compatibility types currently live mainly in:

`packages/types/src/entities.ts`

New work should avoid making this file a larger cross-domain God File where practical.

### Web UI

Next.js lives in:

`apps/web`

Feature components currently include:

- `features/leads`
- `features/real-estate`
- `features/dashboard`
- `features/auth`

The UI may consume capabilities and domain services, but it must not become the security boundary.

### Tests

- Core/integration/security: `tests`
- Browser E2E: `tests-e2e/e2e-browser.spec.ts`
- Responsive Visual QA: `tests-e2e/visual-qa.spec.ts`

Every important invariant requires an automated test.

## 8. Important “do not do this” rules

Do not:

- write directly to `main`;
- merge without explicit human approval;
- create or transition Leads through ad-hoc SQL;
- create a second Opportunity implementation under CRM;
- make Sales depend on Real Estate-specific concepts;
- infer Opportunity linkage from Lead alone;
- edit an applied migration;
- bypass tenant scoping because “the UI already filtered it”;
- make an architectural change silently because tests are green;
- introduce a broad rewrite to solve a narrow problem;
- use Lead status as forecast pipeline truth;
- use Opportunity value as realized revenue truth.

## 9. Current R1 architecture status

### Completed

- R1.1 architecture audit.
- R1.2 Lead lifecycle hardening.
  - canonical Lead creation path;
  - canonical stage-transition path;
  - stage history / timestamps / closure semantics;
  - Meta, WhatsApp, CSV Import, Reservation, Contract, Visit and Smart Rules routed through lifecycle invariants;
  - canonical Lead-status DB guard.
- R1.3A Opportunity domain boundary.
  - Sales owns Opportunity;
  - one Lead → many Opportunities;
  - compatibility Deal APIs retained;
  - Opportunity permissions added.
- R1.3B Opportunity ↔ Reservation ↔ Contract linkage.
  - nullable additive linkage;
  - no guessed historical backfill;
  - tenant/Lead-safe database constraints;
  - Reservation/Contract consistency guards.

### Next design slice — not implemented yet

**R1.3C: Opportunity lifecycle behavior**

Before coding, decide explicitly:

- Does creating a Reservation advance an Opportunity?
- If yes, to which stage?
- Does signing/activating a Contract make the Opportunity `WON`?
- What happens when a Reservation expires or is cancelled?
- How are multiple Opportunities for one Lead kept independent?
- Where does Opportunity-level Lost Reason live?
- When should analytics switch fully to open Opportunity stages?

Do not implement R1.3C until these rules are designed and tested on paper first.

### Later refactor slices from Architecture Audit

- move Property Interest / matching to a clearer Real Estate boundary;
- split `views/read-models.ts` by use case/domain;
- split shared entity schemas by domain while preserving compatibility exports;
- move shared transaction/audit primitives out of CRM ownership;
- add stronger subpath/module-boundary enforcement;
- remove remaining direct web → database access where possible;
- split oversized UI/test files after domain boundaries stabilize.

## 10. Fast navigation

If you need to understand:

- Lead behavior → `packages/core/src/crm/lead-service.ts` and `lead-lifecycle.ts`
- Opportunities → `packages/core/src/sales/opportunity-service.ts`
- Reservations → `packages/core/src/real-estate/reservation-service.ts`
- Contracts → `packages/core/src/real-estate/contract-service.ts`
- Projects / Units → `packages/core/src/real-estate/project-service.ts`, `unit-service.ts`
- Permissions → `packages/core/src/permissions`
- RLS / tenant context → `packages/database/src/tenant-context.ts` and migrations
- Analytics → `packages/core/src/analytics`
- UI read models → `packages/core/src/views/read-models.ts`
- Architecture decisions → `docs/DECISIONS.md`
- Delivery rules → `AGENTS.md` and `docs/DEVELOPMENT_WORKFLOW.md`

When this map conflicts with executable code or a newer migration, verify the code and update this document in the same PR.
