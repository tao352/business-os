import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import {
  type TenantContext,
  type CreateSavedViewInput,
  type EntityQueryOptions,
  type EntityQueryResult,
  type SavedView,
  type UpdateSavedViewInput,
  CreateSavedViewInputSchema,
  UpdateSavedViewInputSchema,
} from "@business-os/types";
import { queryEntities } from "../query/entity-query-service.js";

export class ViewNotFoundError extends Error {
  constructor(public readonly viewId: string) {
    super(`Saved view '${viewId}' not found`);
    this.name = "ViewNotFoundError";
  }
}

export class ViewForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewForbiddenError";
  }
}

export async function createSavedView(
  context: TenantContext,
  rawInput: CreateSavedViewInput,
): Promise<SavedView> {
  const input = CreateSavedViewInputSchema.parse(rawInput);

  return await withTenantContext(context.organizationId, async (client) => {
    // If setting as default, reset other default views for this user & entity
    if (input.is_default) {
      await client.query(
        `UPDATE saved_views
         SET is_default = false
         WHERE user_id = $1 AND entity_type = $2`,
        [context.userId, input.entity_type],
      );
    }

    const insertSql = `
      INSERT INTO saved_views (
        organization_id,
        user_id,
        entity_type,
        name,
        description,
        filter_ast,
        sort_config,
        columns_config,
        is_default,
        is_shared
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const res = await client.query<SavedView>(insertSql, [
      context.organizationId,
      context.userId,
      input.entity_type,
      input.name,
      input.description ?? null,
      JSON.stringify(input.filter_ast),
      JSON.stringify(input.sort_config),
      JSON.stringify(input.columns_config),
      input.is_default,
      input.is_shared,
    ]);

    const created = res.rows[0];
    if (!created) {
      throw new Error("Failed to create saved view");
    }

    logger.info(
      {
        organizationId: context.organizationId,
        viewId: created.id,
        name: created.name,
      },
      "Successfully created saved view",
    );

    return created;
  });
}

export async function listSavedViews(
  context: TenantContext,
  entityType: string,
): Promise<SavedView[]> {
  return await withTenantContext(context.organizationId, async (client) => {
    const querySql = `
      SELECT * FROM saved_views
      WHERE entity_type = $1
        AND (is_shared = true OR user_id = $2)
      ORDER BY is_default DESC, name ASC
    `;

    const res = await client.query<SavedView>(querySql, [
      entityType,
      context.userId,
    ]);
    return res.rows;
  });
}

export async function getSavedView(
  context: TenantContext,
  viewId: string,
): Promise<SavedView> {
  return await withTenantContext(context.organizationId, async (client) => {
    const res = await client.query<SavedView>(
      `SELECT * FROM saved_views WHERE id = $1`,
      [viewId],
    );

    const view = res.rows[0];
    if (!view) {
      throw new ViewNotFoundError(viewId);
    }

    // Must be either shared or owned by this user
    if (!view.is_shared && view.user_id !== context.userId) {
      throw new ViewForbiddenError(
        "You do not have access to this private saved view",
      );
    }

    return view;
  });
}

export async function updateSavedView(
  context: TenantContext,
  viewId: string,
  rawInput: UpdateSavedViewInput,
): Promise<SavedView> {
  const input = UpdateSavedViewInputSchema.parse(rawInput);

  return await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<SavedView>(
      `SELECT * FROM saved_views WHERE id = $1`,
      [viewId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new ViewNotFoundError(viewId);
    }

    // Only creator or organization OWNER/ADMIN can edit
    const isOwnerOrAdmin = context.role === "OWNER" || context.role === "ADMIN";
    if (existing.user_id !== context.userId && !isOwnerOrAdmin) {
      throw new ViewForbiddenError(
        "Only the view owner or an admin can modify this saved view",
      );
    }

    if (input.is_default) {
      await client.query(
        `UPDATE saved_views
         SET is_default = false
         WHERE user_id = $1 AND entity_type = $2`,
        [context.userId, existing.entity_type],
      );
    }

    const updates: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [viewId];
    let idx = 2;

    if (input.name !== undefined) {
      updates.push(`name = $${idx++}`);
      params.push(input.name);
    }
    if (input.description !== undefined) {
      updates.push(`description = $${idx++}`);
      params.push(input.description);
    }
    if (input.filter_ast !== undefined) {
      updates.push(`filter_ast = $${idx++}`);
      params.push(JSON.stringify(input.filter_ast));
    }
    if (input.sort_config !== undefined) {
      updates.push(`sort_config = $${idx++}`);
      params.push(JSON.stringify(input.sort_config));
    }
    if (input.columns_config !== undefined) {
      updates.push(`columns_config = $${idx++}`);
      params.push(JSON.stringify(input.columns_config));
    }
    if (input.is_default !== undefined) {
      updates.push(`is_default = $${idx++}`);
      params.push(input.is_default);
    }
    if (input.is_shared !== undefined) {
      updates.push(`is_shared = $${idx++}`);
      params.push(input.is_shared);
    }

    const updateSql = `
      UPDATE saved_views
      SET ${updates.join(", ")}
      WHERE id = $1
      RETURNING *
    `;

    const res = await client.query<SavedView>(updateSql, params);
    const updated = res.rows[0];
    if (!updated) {
      throw new Error("Failed to update saved view");
    }

    return updated;
  });
}

export async function deleteSavedView(
  context: TenantContext,
  viewId: string,
): Promise<void> {
  await withTenantContext(context.organizationId, async (client) => {
    const existingRes = await client.query<SavedView>(
      `SELECT * FROM saved_views WHERE id = $1`,
      [viewId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      throw new ViewNotFoundError(viewId);
    }

    const isOwnerOrAdmin = context.role === "OWNER" || context.role === "ADMIN";
    if (existing.user_id !== context.userId && !isOwnerOrAdmin) {
      throw new ViewForbiddenError(
        "Only the view owner or an admin can delete this saved view",
      );
    }

    await client.query(`DELETE FROM saved_views WHERE id = $1`, [viewId]);
  });
}

export async function executeSavedView<T extends Record<string, any>>(
  context: TenantContext,
  viewId: string,
  runtimeOverrides?: Partial<EntityQueryOptions>,
): Promise<{ view: SavedView; result: EntityQueryResult<T> }> {
  const view = await getSavedView(context, viewId);

  const queryOptions: EntityQueryOptions = {
    filter_ast: runtimeOverrides?.filter_ast ?? view.filter_ast,
    sort_config: runtimeOverrides?.sort_config ?? view.sort_config,
    search: runtimeOverrides?.search,
    limit: runtimeOverrides?.limit ?? 50,
    offset: runtimeOverrides?.offset ?? 0,
  };

  const result = await queryEntities<T>(
    context,
    view.entity_type,
    queryOptions,
  );
  return { view, result };
}
