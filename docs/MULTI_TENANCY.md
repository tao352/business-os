# MULTI-TENANCY & DATA ISOLATION CONSTITUTION

## 1. The Isolation Invariant

Under no circumstances may data belonging to Organization A ever be viewed, modified, or inferred by Organization B. Tenant isolation is mathematically enforced at the PostgreSQL engine level via **Row-Level Security (RLS)**.

---

## 2. Row-Level Security Implementation

Every tenant-aware table must define:

```sql
-- Enable and force RLS (even table owners must obey RLS)
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

-- Restrictive isolation policy based on session setting
CREATE POLICY tenant_isolation_policy ON leads
  AS RESTRICTIVE
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```

---

## 3. Application Session Management

The application communicates with the database using a pooled database user (`app_user`). Before any transaction or query runs, the tenant context is set:

```typescript
import { db } from "@business-os/database";

export async function withTenantContext<T>(
  organizationId: string,
  callback: (client: typeof db) => Promise<T>,
): Promise<T> {
  return await db.transaction(async (tx) => {
    // Inject the tenant context into the PostgreSQL session
    await tx.raw("SET LOCAL app.current_tenant_id = ?", [organizationId]);
    return await callback(tx);
  });
}
```

If a query executes without setting `app.current_tenant_id`, `current_setting('app.current_tenant_id', true)` evaluates to `NULL` or empty, and PostgreSQL returns zero rows.

---

## 4. Automated Attack Verification (Leak Fuzzing)

We maintain a dedicated test harness (`tests/tenant-isolation.test.ts`) that runs in CI:

1. Spawns two isolated organizations: `Org_Alpha` and `Org_Beta`.
2. Creates sensitive mock leads and units in both organizations.
3. Authenticates as `Org_Alpha` and executes:
   - Direct SELECT attempts on `Org_Beta` records.
   - Blind UPDATE statements targeting `Org_Beta` IDs.
   - Blind DELETE statements targeting `Org_Beta` IDs.
   - Raw custom field searches across tenant boundaries.
4. Asserts that 100% of unauthorized attempts return 0 rows or throw security exceptions.
