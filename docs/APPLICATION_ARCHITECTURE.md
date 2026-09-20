# Business OS — Application Web Architecture

## 1. High-Level Topology

```text
┌─────────────────────────────────────────────────────────────┐
│                           Browser                           │
│  (Next.js App Router Client Components, Forms, Modals)     │
└──────────────────────────────┬──────────────────────────────┘
                               │ HTTPS / Server Actions / Cookies
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    Next.js Server Runtime                    │
│                                                             │
│  1. Cookie Store (HttpOnly, Secure, SameSite=Lax)           │
│  2. requireTenantContext()                                  │
│     - Cryptographic HS256 Token Verification (jose)         │
│     - Live Database Membership & Active User Validation     │
│     - Correlation ID Attachment                             │
│  3. Server Actions & Route Handlers                         │
│     - Input Validation & Permission Assertion               │
└──────────────────────────────┬──────────────────────────────┘
                               │ In-Memory Function Calls
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Core Domain (@business-os/core)              │
│                                                             │
│  - CRM Services (Leads, Activities, Tasks, Custom Data)     │
│  - Permissions & RBAC Matrix                                │
│  - Real Estate Services (Projects, Units)                   │
│  - Audit Logging & Activity Streams                         │
└──────────────────────────────┬──────────────────────────────┘
                               │ withTenantContext()
                               ▼
┌─────────────────────────────────────────────────────────────┐
│               Database Layer (@business-os/database)         │
│                                                             │
│  - Connection Pool (pg.Pool with app_user least privilege)  │
│  - Transaction Boundary (BEGIN / COMMIT / ROLLBACK)         │
│  - Session Configuration: set_config('app.current_tenant_id')│
│  - Row-Level Security (RLS) & Composite Foreign Keys        │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Layer-by-Layer Walkthrough

### 2.1 Browser Layer

- **Technology:** Next.js 15 App Router, React 19, Tailwind CSS.
- **Visual Character:** Quiet enterprise confidence (dark charcoal `#18181B` sidebar, warm off-white `#F7F7F5` canvas, subtle borders, high information density, anti-AI-slop design).
- **Security Rule:** The browser **never** stores tokens in `localStorage` or `sessionStorage`. All authentication state is managed through secure `HttpOnly` cookies.
- **Client vs Server Boundary:** Client components (`"use client"`) are strictly reserved for interactive controls (modals, drawers, filter toolbars, toast feedback). Data fetching is done via React Server Components.

### 2.2 Next.js Server & Request Context

- **Session Cookie:** `business_os_session` containing a cryptographically signed JWT.
- **Central Resolver (`requireTenantContext`):**
  1. Reads `business_os_session` from incoming request headers.
  2. Cryptographically verifies the signature using `getJwtSecret()`.
  3. Queries PostgreSQL `organization_memberships` and `users` to assert the user and membership are currently active.
  4. Resolves the authoritative `TenantRole` directly from the database (not trusting client claims).
  5. Attaches an end-to-end request correlation ID.
- **Tenant Spoofing Defense:**
  - Client-supplied `organizationId` or `userId` in request bodies or query parameters are ignored for authorization.
  - Organization switching requires explicit server-side validation through `switchOrganization()`.

### 2.3 Core Domain Layer (`@business-os/core`)

- Direct programmatic invocation from Server Components and Server Actions.
- **Zero Raw SQL in Presentation Layer:** Next.js never executes direct SQL queries or accesses database clients in `apps/web/app/**`. All presentation queries are routed strictly through typed read-model services (`packages/core/src/views/read-models.ts`):
  - `getDashboardOverview(context)`: Aggregated pipeline metrics, recent leads, and salesperson-isolated activity stream.
  - `listLeadsPage(context, filters)`: Paginated lead listing with search, status filtering, and server-side PII masking.
  - `getLeadWorkspace(context, leadId)`: Full lead dossier including assignee details, chronological activity timeline, pending tasks, and org members.
  - `listProjectsOverview(context)`: Truthful inventory overview without fabricated statuses.
  - `listUnitsInventory(context, filters)`: Paginated units inventory with truthful total count.
  - `getIntegrationStatus(context)`: Channel status querying `meta_integrations` and `whatsapp_integrations` without secret leakage.
  - `listAutomationRules(context)`: Event-driven rules querying `automation_rules` with truthful `trigger_type`.
  - `getOrganizationSettings(context)`: Active workspace settings and authorized team roster.
- **Strict MARKETING_USER Aggregate-Only Policy:** The `MARKETING_USER` role is strictly confined to aggregated/reporting analytics and barred from individual customer records at the core layer via `assertCanAccessIndividualLeadRecords(context)`. Core services (`getLead`, `listLeads`, `listLeadActivities`, `listTasks`, `createTask`, `completeTask`, `logActivity`) fail closed with typed `ForbiddenError` when called by `MARKETING_USER`.
- **Row-Level Mutation Authorization & Atomic Rollback:**
  - `logActivity(context, input)`: Asserts individual lead access, loads the target lead inside the database transaction, and calls `assertPermission(context, "update", "lead", targetLead)` _before_ updating `leads.last_contacted_at` or inserting the activity. If an unauthorized agent calls `logActivity`, the transaction immediately aborts without updating timestamps.
  - `createTask(context, input)`: Loads the target lead within the transaction and asserts row-level update permission; enforces that `SALESPERSON` can only assign to themselves; and verifies that the assignee is an active member of the tenant organization.
  - `completeTask(context, taskId)`: Asserts static lead update permission (immediately blocking `READ_ONLY` and `MARKETING_USER`), verifies row-level authorization against the associated lead, and strictly forbids `SALESPERSON` from completing tasks assigned to other agents.
- **Salesperson Scoping Isolation:** When accessed by users with `SALESPERSON` role, leads and activity streams are strictly scoped to leads assigned to `context.userId`.
- **Permissions & Authoritative Capability Model:**
  - `getUiCapabilities(context)` resolves typed, matrix-backed capability flags (`canCreateLead`, `canReadProjects`, `canReadUnits`, `canReadAutomations`, `canReadIntegrations`, `canReadSettings`, `canExportLeads`, `canUpdateAllLeads`).
  - Presentation components use these capabilities rather than guessing permissions from roles:
    - **Sidebar Navigation:** Renders "Projects" only if `canReadProjects` (e.g. omitted for `FINANCE`) and "Units" only if `canReadUnits` (visible for `FINANCE`), while omitting privileged system items for non-admin roles.
    - **Topbar:** Suppresses "New Lead" action button if `!canCreateLead` (e.g. for `READ_ONLY`, `FINANCE`, `MARKETING_USER`).
    - **Breadcrumbs:** Sanitizes raw route UUID segments into user-friendly `Lead Details`.
    - **Lead Action Bar:** Gates "Change Status", "Add Note", "Follow-up", and "Reassign"; renders a clean "Read-only view" badge when mutation permissions are absent.
    - **Task Completion Controls:** Hides completion triggers on Dashboard and Lead Side Panel for users lacking lead update permissions or non-assigned salespersons.

### 2.4 Server Actions & Input Validation

- **Zod Schema Validation:** All user mutations in `apps/web/lib/actions/*` and sensitive API route handlers (e.g. `/api/auth/switch-org`) strictly validate inputs using centralized Zod schemas (`apps/web/lib/validations/action-schemas.ts`).
- **Atomic Sliding-Window Rate Limiting:** `/api/auth/login` uses `consumeRateLimit()` backed by Redis (or in-memory sliding window fallback) keyed by `auth:login:${clientIp}:${normalizedEmail}` to defend against credential brute-forcing and account enumeration without disclosing user account existence.

### 2.5 Database & Row-Level Security (`@business-os/database`)

- **Connection Isolation:** All operations wrap in `withTenantContext(organizationId, callback)`.
- **PostgreSQL Session Variables:**
  ```sql
  SET LOCAL ROLE app_user;
  SELECT set_config('app.current_tenant_id', $1, true);
  ```
- **RLS Policies:** Every table enforces tenant isolation at the database engine level via `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.
- **Integrity:** Composite foreign keys `(organization_id, id)` prevent cross-tenant referencing.

---

---

## 3. Production Environment Safety & Database Runtime Parity

### 3.1 Fail-Closed Boot & Runtime Role Assertion

- In production (`NODE_ENV === 'production'`), startup is immediately halted if `DATABASE_URL`, `JWT_SECRET` (minimum 32 characters), or `ENCRYPTION_KEY` (32 bytes) are missing or set to trivial/dev defaults.
- **Runtime Least-Privilege Assertion (`assertLeastPrivilegeRuntimeDatabaseRole`):** Wire-checked on Next.js startup via `apps/web/instrumentation.ts`. Asserts that the runtime user is `app_user` and is strictly non-privileged (`rolsuper = false`, `rolbypassrls = false`, `rolcreatedb = false`, `rolcreaterole = false`). If the Web App connects as a superuser or privileged role, startup is immediately aborted.

### 3.2 Production Database Runtime & Auth Bootstrap

- **Runtime DB Connection:** Web App `DATABASE_URL` connects exclusively as `app_user` (least privilege, `NOSUPERUSER`, `NOBYPASSRLS`).
- **Administrative Operations:** Schema migrations, role provisioning, and fixture administration run out-of-band using `MIGRATOR_DATABASE_URL` / `migratorPool`.
- **Pre-Tenant Membership Discovery:**
  - `organization_memberships` remains strictly protected under `FORCE ROW LEVEL SECURITY`.
  - When a user logs in, credentials (`password_hash`) are verified against `users` table **before** any membership enumeration occurs.
  - The SQL function `public.auth_list_active_memberships(user_id)` is the **ONLY** pre-tenant membership enumeration path.
  - It is a narrow `SECURITY DEFINER` router owned by a dedicated `NOLOGIN BYPASSRLS` role (`business_os_auth_router_owner`).
  - `EXECUTE` is explicitly revoked from `PUBLIC` and granted exclusively to `app_user`.
  - It exposes only minimum bootstrap metadata (`organization_id`, `organization_name`, `organization_slug`, `role`).
  - _Security scope:_ The function exposes only minimum membership metadata and does not grant direct table-wide access to `app_user`. It does not eliminate all theoretical function calls if the runtime role itself is compromised, but ensures zero direct table access.
- **Post-Bootstrap Operations (Normal Tenant RLS):**
  - Once a tenant is selected, `resolveTenantContextFromToken()` and `switchOrganization()` validate active memberships using normal tenant RLS inside `withTenantContext(organizationId)`.
  - Organization creation (`createOrganization`) executes under `app_user`, sets `app.current_tenant_id` to the new org within the transaction, and writes the `OWNER` membership row atomically without requiring any privileged router.
- **Automated Security & Audit Tooling:**
  - **pgrls (`pgrls.toml`):** Static and live database audit verifying that `SECURITY DEFINER` functions (`SEC014`, `SEC015`) and `BYPASSRLS` roles (`SEC016`) are strictly audited, allowlisted, and search-path hardened.
  - **Gitleaks:** CI secret scanning on every push and PR to verify no credentials or tokens are committed.
  - **Browser E2E Parity:** Playwright tests run against an actual Next.js process connected as `app_user` with admin credentials stripped from its environment.

---

## 4. Browser-Level E2E Verification & Visual QA

- **Playwright Test Suite (`tests-e2e/e2e-browser.spec.ts`):**
  - Unauthenticated route protection: asserts automatic redirect to `/login` for all `/app/**` routes.
  - End-to-end operational journey: verifies authentication, dashboard rendering, lead table navigation, workspace inspection, pipeline stage updating to `QUALIFIED`, and live customer timeline record creation.
  - Cross-tenant isolation negative test: asserts that authenticated user from Tenant A attempting direct navigation to Tenant B's lead URL receives 404 with zero tenant B data disclosure.
  - Brute-force rate limiting: asserts that rapid failed login attempts trigger HTTP 429 Too Many Requests with standard response.
- **Visual QA Snapshot Testing (`tests-e2e/visual-qa.spec.ts`):**
  - Responsive visual regression across Desktop (1440px), Tablet (1024px), and Mobile (390px) viewports.
  - Off-canvas drawer navigation for small screens with auto-dismissing backdrop and link triggers.
  - Anti-AI-slop design system verification (zero gratuitous gradients, high contrast typographic hierarchy, truthful state indicators).
