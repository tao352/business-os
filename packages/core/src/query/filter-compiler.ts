import type {
  FilterAST,
  FilterCondition,
  FilterGroup,
  SortConfig,
} from "@business-os/types";

export class InvalidQueryFieldError extends Error {
  constructor(
    public readonly field: string,
    public readonly entityType: string,
  ) {
    super(
      `Invalid or disallowed query field '${field}' for entity '${entityType}'`,
    );
    this.name = "InvalidQueryFieldError";
  }
}

export class InvalidQueryOperatorError extends Error {
  constructor(public readonly operator: string) {
    super(`Unsupported query operator '${operator}'`);
    this.name = "InvalidQueryOperatorError";
  }
}

// Strict whitelist of standard SQL columns per entity
export const ENTITY_COLUMN_WHITELISTS: Record<string, Set<string>> = {
  leads: new Set([
    "id",
    "organization_id",
    "full_name",
    "phone",
    "email",
    "status",
    "assigned_user_id",
    "campaign_id",
    "source",
    "last_contacted_at",
    "created_at",
    "updated_at",
  ]),
  deals: new Set([
    "id",
    "organization_id",
    "lead_id",
    "title",
    "value",
    "currency",
    "stage",
    "expected_close_date",
    "assigned_user_id",
    "created_at",
    "updated_at",
  ]),
  tasks: new Set([
    "id",
    "organization_id",
    "lead_id",
    "assigned_user_id",
    "title",
    "description",
    "due_date",
    "priority",
    "is_completed",
    "completed_at",
    "completed_by_user_id",
    "created_at",
  ]),
  units: new Set([
    "id",
    "organization_id",
    "project_id",
    "unit_number",
    "unit_type",
    "gross_area",
    "price",
    "currency",
    "status",
    "created_at",
    "updated_at",
  ]),
  projects: new Set([
    "id",
    "organization_id",
    "name",
    "location",
    "description",
    "total_units",
    "created_at",
  ]),
};

const CUSTOM_FIELD_KEY_REGEX = /^[a-z0-9_]{2,50}$/;

export interface CompiledFilter {
  sql: string;
  params: unknown[];
  nextParamIndex: number;
}

function resolveColumnExpression(
  entityType: string,
  field: string,
  isCustom = false,
  value?: unknown,
): string {
  const whitelist = ENTITY_COLUMN_WHITELISTS[entityType];
  const isStandardCol = whitelist?.has(field);

  if (isStandardCol && !isCustom) {
    return `"${field}"`;
  }

  // If custom field, strictly validate regex slug to prevent injection
  if (!CUSTOM_FIELD_KEY_REGEX.test(field)) {
    throw new InvalidQueryFieldError(field, entityType);
  }

  // If the filter comparison uses a number, cast the JSONB value to numeric
  if (
    typeof value === "number" ||
    (Array.isArray(value) && typeof value[0] === "number")
  ) {
    return `NULLIF(custom_data->>'${field}', '')::numeric`;
  }

  return `(custom_data->>'${field}')`;
}

function compileCondition(
  entityType: string,
  cond: FilterCondition,
  startIndex: number,
  params: unknown[],
): { sql: string; nextIndex: number } {
  const colExpr = resolveColumnExpression(
    entityType,
    cond.field,
    cond.is_custom,
    cond.value,
  );
  let curIndex = startIndex;

  switch (cond.operator) {
    case "EQUALS":
      if (cond.value === null || cond.value === undefined) {
        return { sql: `${colExpr} IS NULL`, nextIndex: curIndex };
      }
      params.push(cond.value);
      return { sql: `${colExpr} = $${curIndex}`, nextIndex: curIndex + 1 };

    case "NOT_EQUALS":
      if (cond.value === null || cond.value === undefined) {
        return { sql: `${colExpr} IS NOT NULL`, nextIndex: curIndex };
      }
      params.push(cond.value);
      return { sql: `${colExpr} != $${curIndex}`, nextIndex: curIndex + 1 };

    case "CONTAINS":
      params.push(`%${String(cond.value ?? "")}%`);
      return { sql: `${colExpr} ILIKE $${curIndex}`, nextIndex: curIndex + 1 };

    case "STARTS_WITH":
      params.push(`${String(cond.value ?? "")}%`);
      return { sql: `${colExpr} ILIKE $${curIndex}`, nextIndex: curIndex + 1 };

    case "GREATER_THAN":
      params.push(cond.value);
      return { sql: `${colExpr} > $${curIndex}`, nextIndex: curIndex + 1 };

    case "GREATER_THAN_OR_EQUAL":
      params.push(cond.value);
      return { sql: `${colExpr} >= $${curIndex}`, nextIndex: curIndex + 1 };

    case "LESS_THAN":
      params.push(cond.value);
      return { sql: `${colExpr} < $${curIndex}`, nextIndex: curIndex + 1 };

    case "LESS_THAN_OR_EQUAL":
      params.push(cond.value);
      return { sql: `${colExpr} <= $${curIndex}`, nextIndex: curIndex + 1 };

    case "IN": {
      const arr = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (arr.length === 0) return { sql: "FALSE", nextIndex: curIndex };
      params.push(arr);
      return { sql: `${colExpr} = ANY($${curIndex})`, nextIndex: curIndex + 1 };
    }

    case "NOT_IN": {
      const arr = Array.isArray(cond.value) ? cond.value : [cond.value];
      if (arr.length === 0) return { sql: "TRUE", nextIndex: curIndex };
      params.push(arr);
      return {
        sql: `${colExpr} != ALL($${curIndex})`,
        nextIndex: curIndex + 1,
      };
    }

    case "IS_NULL":
      return { sql: `${colExpr} IS NULL`, nextIndex: curIndex };

    case "IS_NOT_NULL":
      return { sql: `${colExpr} IS NOT NULL`, nextIndex: curIndex };

    case "BETWEEN": {
      if (!Array.isArray(cond.value) || cond.value.length !== 2) {
        throw new Error(
          `Operator BETWEEN requires an array of 2 values for field '${cond.field}'`,
        );
      }
      params.push(cond.value[0]);
      params.push(cond.value[1]);
      const sql = `${colExpr} BETWEEN $${curIndex} AND $${curIndex + 1}`;
      return { sql, nextIndex: curIndex + 2 };
    }

    default:
      throw new InvalidQueryOperatorError(cond.operator);
  }
}

export function compileFilterGroup(
  entityType: string,
  group: FilterGroup,
  startIndex: number,
  params: unknown[],
): { sql: string; nextIndex: number } {
  if (!group.conditions || group.conditions.length === 0) {
    return { sql: "TRUE", nextIndex: startIndex };
  }

  const parts: string[] = [];
  let curIndex = startIndex;

  for (const item of group.conditions) {
    if ("logical" in item) {
      const res = compileFilterGroup(
        entityType,
        item as FilterGroup,
        curIndex,
        params,
      );
      if (res.sql && res.sql !== "TRUE") {
        parts.push(`(${res.sql})`);
        curIndex = res.nextIndex;
      }
    } else {
      const res = compileCondition(
        entityType,
        item as FilterCondition,
        curIndex,
        params,
      );
      parts.push(res.sql);
      curIndex = res.nextIndex;
    }
  }

  if (parts.length === 0) {
    return { sql: "TRUE", nextIndex: curIndex };
  }

  const joiner = group.logical === "OR" ? " OR " : " AND ";
  return { sql: parts.join(joiner), nextIndex: curIndex };
}

export function compileSortToSql(
  entityType: string,
  sortConfig?: SortConfig[],
): string {
  if (!sortConfig || sortConfig.length === 0) {
    return 'ORDER BY "created_at" DESC';
  }

  const clauses: string[] = [];
  for (const sort of sortConfig) {
    const colExpr = resolveColumnExpression(
      entityType,
      sort.field,
      sort.is_custom,
    );
    const direction = sort.direction.toLowerCase() === "asc" ? "ASC" : "DESC";
    const nulls = sort.nulls ? `NULLS ${sort.nulls.toUpperCase()}` : "";
    clauses.push(`${colExpr} ${direction} ${nulls}`.trim());
  }

  return `ORDER BY ${clauses.join(", ")}`;
}

export function compileSearchToSql(
  entityType: string,
  search: string,
  startIndex: number,
  params: unknown[],
): { sql: string; nextIndex: number } {
  const term = `%${search.trim()}%`;
  params.push(term);

  switch (entityType) {
    case "leads":
      return {
        sql: `("full_name" ILIKE $${startIndex} OR "phone" ILIKE $${startIndex} OR "email" ILIKE $${startIndex})`,
        nextIndex: startIndex + 1,
      };
    case "deals":
      return {
        sql: `"title" ILIKE $${startIndex}`,
        nextIndex: startIndex + 1,
      };
    case "tasks":
      return {
        sql: `("title" ILIKE $${startIndex} OR "description" ILIKE $${startIndex})`,
        nextIndex: startIndex + 1,
      };
    case "units":
      return {
        sql: `("unit_number" ILIKE $${startIndex} OR "unit_type" ILIKE $${startIndex})`,
        nextIndex: startIndex + 1,
      };
    case "projects":
      return {
        sql: `("name" ILIKE $${startIndex} OR "location" ILIKE $${startIndex})`,
        nextIndex: startIndex + 1,
      };
    default:
      return { sql: "TRUE", nextIndex: startIndex };
  }
}
