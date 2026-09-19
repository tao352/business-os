import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  EntityQueryOptions,
  EntityQueryResult,
  FilterCondition,
  FilterGroup,
} from "@business-os/types";
import {
  compileFilterGroup,
  compileSearchToSql,
  compileSortToSql,
  ENTITY_COLUMN_WHITELISTS,
} from "./filter-compiler.js";

export class UnsupportedEntityError extends Error {
  constructor(public readonly entityType: string) {
    super(`Entity type '${entityType}' is not supported for dynamic querying`);
    this.name = "UnsupportedEntityError";
  }
}

export async function queryEntities<T extends Record<string, any>>(
  context: TenantContext,
  entityType: string,
  options: EntityQueryOptions = { limit: 50, offset: 0 },
): Promise<EntityQueryResult<T>> {
  if (!ENTITY_COLUMN_WHITELISTS[entityType]) {
    throw new UnsupportedEntityError(entityType);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
  const offset = Math.max(options.offset ?? 0, 0);

  // Prepare filter conditions
  const conditions: (FilterCondition | FilterGroup)[] = [];

  // Enforce Salesperson row-level isolation for leads
  if (entityType === "leads" && context.role === "SALESPERSON") {
    conditions.push({
      field: "assigned_user_id",
      operator: "EQUALS",
      value: context.userId,
    });
  }

  // Include user-provided filter AST
  if (options.filter_ast && options.filter_ast.conditions.length > 0) {
    conditions.push(options.filter_ast);
  }

  const rootFilterGroup: FilterGroup = {
    logical: "AND",
    conditions,
  };

  return await withTenantContext(context.organizationId, async (client) => {
    const params: unknown[] = [];
    let paramIndex = 1;

    // 1. Compile Filters
    const filterRes = compileFilterGroup(
      entityType,
      rootFilterGroup,
      paramIndex,
      params,
    );
    let whereSql = filterRes.sql;
    paramIndex = filterRes.nextIndex;

    // 2. Compile Search (if provided)
    if (options.search && options.search.trim().length > 0) {
      const searchRes = compileSearchToSql(
        entityType,
        options.search,
        paramIndex,
        params,
      );
      whereSql =
        whereSql === "TRUE"
          ? searchRes.sql
          : `(${whereSql}) AND (${searchRes.sql})`;
      paramIndex = searchRes.nextIndex;
    }

    // 3. Compile Sort
    const sortSql = compileSortToSql(entityType, options.sort_config);

    // 4. Execute Count Query
    const countSql = `SELECT count(*)::int as total FROM "${entityType}" WHERE ${whereSql}`;
    const countResult = await client.query<{ total: number }>(countSql, params);
    const total = countResult.rows[0]?.total ?? 0;

    // 5. Execute Data Query
    const dataParams = [...params, limit, offset];
    const dataSql = `
      SELECT * FROM "${entityType}"
      WHERE ${whereSql}
      ${sortSql}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    const dataResult = await client.query<T>(dataSql, dataParams);
    const data = dataResult.rows;

    logger.info(
      {
        organizationId: context.organizationId,
        userId: context.userId,
        entityType,
        total,
        returned: data.length,
      },
      "Entity query executed successfully",
    );

    return {
      data,
      total,
      limit,
      offset,
      hasMore: offset + data.length < total,
    };
  });
}
