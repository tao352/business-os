import { afterAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { Pool, pool as adminPool } from "../packages/database/src/client.js";
import {
  registerUser,
  createOrganization,
} from "../packages/core/src/index.js";

const appDatabaseUrl = process.env.APP_DATABASE_URL;

describe("Phase 21 production-parity database boundary", () => {
  const runtimePool = appDatabaseUrl
    ? new Pool({
        connectionString: appDatabaseUrl,
        max: 2,
      })
    : null;

  afterAll(async () => {
    if (runtimePool) {
      await runtimePool.end();
    }
  });

  it("app_user is a real least-privilege RLS subject", async () => {
    if (!runtimePool) {
      return;
    }

    const result = await runtimePool.query<{
      current_user: string;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(`
      SELECT
        current_user,
        r.rolsuper,
        r.rolbypassrls,
        r.rolcreatedb,
        r.rolcreaterole
      FROM pg_catalog.pg_roles AS r
      WHERE r.rolname = current_user
    `);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].current_user).toBe("app_user");
    expect(result.rows[0].rolsuper).toBe(false);
    expect(result.rows[0].rolbypassrls).toBe(false);
    expect(result.rows[0].rolcreatedb).toBe(false);
    expect(result.rows[0].rolcreaterole).toBe(false);
  });

  it("direct pre-tenant membership SELECT fails closed but bootstrap router works", async () => {
    if (!runtimePool) {
      return;
    }

    const suffix = crypto.randomBytes(4).toString("hex");

    const user = await registerUser({
      email: `parity.${suffix}@business-os.test`,
      password: "Password123!Secure",
      fullName: "Runtime Parity User",
    });

    const org = await createOrganization({
      userId: user.id,
      name: `Runtime Parity Org ${suffix}`,
      slug: `runtime-parity-${suffix}`,
    });

    const direct = await runtimePool.query(
      `SELECT organization_id
       FROM organization_memberships
       WHERE user_id = $1`,
      [user.id],
    );

    expect(direct.rows).toHaveLength(0);

    const bootstrap = await runtimePool.query<{
      organization_id: string;
      organization_name: string;
      organization_slug: string;
      role: string;
    }>(
      `SELECT *
       FROM public.auth_list_active_memberships($1::uuid)`,
      [user.id],
    );

    expect(bootstrap.rows).toHaveLength(1);
    expect(bootstrap.rows[0].organization_id).toBe(org.id);
    expect(bootstrap.rows[0].role).toBe("OWNER");
  });

  it("auth router owner cannot log in and is narrowly separated from app_user", async () => {
    const result = await adminPool.query<{
      rolname: string;
      rolcanlogin: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolcreatedb: boolean;
      rolcreaterole: boolean;
    }>(
      `SELECT
         rolname,
         rolcanlogin,
         rolsuper,
         rolbypassrls,
         rolcreatedb,
         rolcreaterole
       FROM pg_catalog.pg_roles
       WHERE rolname = 'business_os_auth_router_owner'`,
    );

    expect(result.rows).toHaveLength(1);

    const role = result.rows[0];

    expect(role.rolcanlogin).toBe(false);
    expect(role.rolsuper).toBe(false);
    expect(role.rolbypassrls).toBe(true);
    expect(role.rolcreatedb).toBe(false);
    expect(role.rolcreaterole).toBe(false);
  });
});
