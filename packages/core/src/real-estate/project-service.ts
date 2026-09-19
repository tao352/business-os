import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type Project,
  ProjectSchema,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";

export interface CreateProjectInput {
  name: string;
  location: string;
  description?: string;
  totalUnits?: number;
  customData?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  location?: string;
  description?: string;
  totalUnits?: number;
  customData?: Record<string, unknown>;
}

export async function createProject(
  context: TenantContext,
  input: CreateProjectInput,
): Promise<Project> {
  assertPermission(context, "create", "project");

  return await withTenantContext(context.organizationId, async (client) => {
    const insertSql = `
      INSERT INTO projects (
        organization_id,
        name,
        location,
        description,
        total_units,
        custom_data
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const res = await client.query<Project>(insertSql, [
      context.organizationId,
      input.name.trim(),
      input.location.trim(),
      input.description ?? null,
      input.totalUnits ?? 0,
      JSON.stringify(input.customData ?? {}),
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create project");
    }

    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "project",
      entityId: created.id,
      afterState: created,
    });

    logger.info(
      {
        organizationId: context.organizationId,
        projectId: created.id,
        name: created.name,
      },
      "Successfully created project",
    );

    return created;
  });
}

export async function getProject(
  context: TenantContext,
  projectId: string,
): Promise<Project | null> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<Project>(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId],
    );
    return res.rows[0] ?? null;
  });
}

export async function listProjects(context: TenantContext): Promise<Project[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<Project>(
      `SELECT * FROM projects ORDER BY name ASC`,
    );
    return res.rows;
  });
}

export async function updateProject(
  context: TenantContext,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
  assertPermission(context, "update", "project");

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<Project>(
      `SELECT * FROM projects WHERE id = $1`,
      [projectId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new Error(`Project '${projectId}' not found`);
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [projectId];
    let idx = 2;

    if (input.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(input.name.trim());
    }
    if (input.location !== undefined) {
      updates.push(`location = $${idx++}`);
      params.push(input.location.trim());
    }
    if (input.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(input.description);
    }
    if (input.totalUnits !== undefined) {
      updates.push(`total_units = $${idx++}`);
      params.push(input.totalUnits);
    }
    if (input.customData !== undefined) {
      updates.push(`custom_data = $${idx++}`);
      params.push(JSON.stringify(input.customData));
    }

    const updateSql = `
      UPDATE projects
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING *
    `;

    const res = await client.query<Project>(updateSql, params);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update project");
    }

    await recordAuditLog(client, context, {
      action: "UPDATE",
      entityType: "project",
      entityId: projectId,
      beforeState: existing,
      afterState: updated,
    });

    return updated;
  });
}
