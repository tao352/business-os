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
- **No duplicate business logic:** Next.js never writes raw SQL in page components; all queries execute through `@business-os/core` domain services (`listLeads`, `createLead`, `updateLeadStatus`, `assignLead`, `logActivity`, `createTask`, etc.).
- **Permissions:** Before any mutation or sensitive read, the service invokes `assertPermission(context, action, resource, targetEntity)` ensuring RBAC rules and row-level ownership constraints (e.g. `SALESPERSON` row filtering) are enforced.

### 2.4 Database & Row-Level Security (`@business-os/database`)

- **Connection Isolation:** All operations wrap in `withTenantContext(organizationId, callback)`.
- **PostgreSQL Session Variables:**
  ```sql
  SET LOCAL ROLE app_user;
  SELECT set_config('app.current_tenant_id', $1, true);
  ```
- **RLS Policies:** Every table enforces tenant isolation at the database engine level via `organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`.
- **Integrity:** Composite foreign keys `(organization_id, id)` prevent cross-tenant referencing.

---

## 3. Production Environment Safety

- **Fail-Closed Boot (`validateWebEnvironment`):**
  - In production (`NODE_ENV === 'production'`), startup is immediately halted if `DATABASE_URL`, `JWT_SECRET` (minimum 32 characters), or `ENCRYPTION_KEY` (32 bytes) are missing or set to trivial/dev defaults.
  - Prevents accidental deployment with insecure fallback configurations.
