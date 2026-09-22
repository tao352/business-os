# DATABASE ARCHITECTURE & RELATIONAL SCHEMA

> For the short current domain map and Sources of Truth, read [PROJECT_MAP.md](./PROJECT_MAP.md) first.

## 1. Core Principles

- **Single Database, Shared Schema:** All tenants share the same PostgreSQL database instance and schema.
- **Row-Level Security (RLS):** Tenant-aware tables enforce PostgreSQL RLS; critical tenant tables use `FORCE ROW LEVEL SECURITY`.
- **Relational Tenant Safety:** Composite foreign keys include `organization_id` so cross-tenant references are rejected by PostgreSQL.
- **No Dynamic DDL for Custom Fields:** Tenant custom fields use metadata plus JSONB values instead of customer-driven `ALTER TABLE`.
- **Append-Only Migrations:** Never edit an already-applied migration. Add a new numbered migration.
- **No Fabricated Backfills:** When old data cannot be mapped deterministically, keep it unknown / `NULL`.

---

## 2. Core Entities

### Organizations & Tenancy

- `organizations`: root tenant boundary.
- `users`: user identity accounts.
- `organization_memberships`: user ↔ organization relationship and tenant role.

### CRM

- `leads`: the person/customer relationship.
- `lead_stage_history`: canonical history of Lead lifecycle transitions.
- `activities`: calls, messages, notes, status-change timeline entries.
- `tasks`: follow-up work assigned around a Lead.

### Sales

- `deals`: physical compatibility table for the **Opportunity** domain.
  - Application code should use Opportunity terminology and `packages/core/src/sales/opportunity-service.ts`.
  - Canonical stages: `DISCOVERY`, `PROPOSAL`, `NEGOTIATION`, `WON`, `LOST`.
  - Opportunity is the forecast-deal source of truth.
  - One Lead may have many Opportunities.

### Real Estate

- `projects`: developments / buildings.
- `units`: inventory within Projects.
- `lead_property_interests`: what a Lead is looking for; Real Estate-specific requirements.
- `visits`: scheduled/completed site visits.
- `reservations`: temporary unit holds. May contain nullable `opportunity_id`.
- `contracts`: commercial execution records. May contain nullable `reservation_id` and `opportunity_id`.

R1.3B intentionally leaves historical `reservations.opportunity_id` and `contracts.opportunity_id` as `NULL` unless the correct Opportunity is known deterministically.

### Customization & Metadata

- `custom_field_definitions`: tenant-owned field metadata and validation definitions.
- `custom_entities`: tenant custom-module records.

### Automation & Observability

- `automation_rules` / Smart Rules tables: Trigger-Condition-Action automation definitions and execution state.
- `audit_logs`: security/business audit history.
- `outbox_events`: transactional outbox for reliable asynchronous work.
- `schema_migrations`: applied migration name/checksum history.

---

## 3. Relational Isolation & Composite Foreign Keys

RLS stops one tenant from reading or writing another tenant's rows. Composite foreign keys add a second boundary: a row also cannot **reference** a parent row from another tenant.

Representative enforced relationships include:

- `units (organization_id, project_id) -> projects (organization_id, id)`
- `visits (organization_id, lead_id) -> leads (organization_id, id)`
- `visits (organization_id, project_id) -> projects (organization_id, id)`
- `reservations (organization_id, lead_id) -> leads (organization_id, id)`
- `reservations (organization_id, unit_id) -> units (organization_id, id)`
- `contracts (organization_id, lead_id) -> leads (organization_id, id)`
- `contracts (organization_id, unit_id) -> units (organization_id, id)`
- `contracts (organization_id, reservation_id) -> reservations (organization_id, id)`
- `deals (organization_id, lead_id) -> leads (organization_id, id)`
- `activities (organization_id, lead_id) -> leads (organization_id, id)`
- `tasks (organization_id, lead_id) -> leads (organization_id, id)`

R1.3B adds stronger execution linkage constraints:

- `reservations (organization_id, opportunity_id, lead_id) -> deals (organization_id, id, lead_id)`
- `contracts (organization_id, opportunity_id, lead_id) -> deals (organization_id, id, lead_id)`
- when a Contract contains both `reservation_id` and `opportunity_id`, PostgreSQL enforces that the Reservation has the same Opportunity linkage.

There is **no** `deals.unit_id` relationship in the current schema.

---

## 4. Opportunity Database Guards

Migration `0023_r13b_opportunity_execution_linkage.sql` adds database-level guards so application bypasses cannot create:

- non-canonical Opportunity stages;
- negative Opportunity values;
- cross-tenant Opportunity execution links;
- Opportunity links for the wrong Lead;
- Contract ↔ Reservation Opportunity mismatches.

These constraints complement, not replace, Core permission checks and RLS.

---

## 5. Database Index Strategy

- Tenant and parent lookup pairs are indexed around `organization_id`.
- Foreign-key traversal columns use tenant-prefixed indexes where appropriate.
- R1.3B adds partial Opportunity indexes:
  - `reservations (organization_id, opportunity_id) WHERE opportunity_id IS NOT NULL`
  - `contracts (organization_id, opportunity_id) WHERE opportunity_id IS NOT NULL`
- Frequently queried JSONB keys may use expression indexes.
- pgvector data uses vector-specific indexes where configured for semantic retrieval.

---

## 6. Migration Rules

Schema changes use the safest applicable form of **Expand → Migrate → Switch → Contract**.

Permanent rules:

1. never rewrite an already-applied migration;
2. prefer additive nullable fields before stricter requirements;
3. preflight legacy data before adding a constraint that could reinterpret it;
4. do not guess old data;
5. preserve backward compatibility until callers have migrated;
6. run migrations under the administrative migrator role, never by weakening runtime `app_user` security.
