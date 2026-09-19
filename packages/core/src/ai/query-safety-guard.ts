import {
  type StructuredQueryIntent,
  StructuredQueryIntentSchema,
} from "@business-os/types";
import { ENTITY_COLUMN_WHITELISTS } from "../query/filter-compiler.js";

export class SqlSafetyViolationError extends Error {
  constructor(message: string) {
    super(`SQL Safety Violation: ${message}`);
    this.name = "SqlSafetyViolationError";
  }
}

export class UnsupportedQueryError extends Error {
  constructor(message: string) {
    super(`Unsupported Query: ${message}`);
    this.name = "UnsupportedQueryError";
  }
}

const NUMERIC_FIELDS: Record<string, string[]> = {
  leads: [],
  units: ["price", "gross_area"],
  projects: ["total_units"],
  contracts: ["contract_value"],
  reservations: ["deposit_amount"],
  deals: ["value"],
};

export interface CompiledStructuredQuery {
  sql: string;
  params: unknown[];
  intent: StructuredQueryIntent;
}

/**
 * Compiles a strictly validated StructuredQueryIntent into safe, parameterized SQL.
 * Rejects arbitrary SQL, forbidden tables, functions, or un-whitelisted fields.
 */
export function compileStructuredIntentToSql(
  rawIntent: unknown,
): CompiledStructuredQuery {
  const parsed = StructuredQueryIntentSchema.safeParse(rawIntent);
  if (!parsed.success) {
    throw new UnsupportedQueryError(
      `Invalid query intent structure: ${parsed.error.message}`,
    );
  }

  const intent = parsed.data;
  const entity = intent.entity;
  const whitelist = ENTITY_COLUMN_WHITELISTS[entity];

  if (!whitelist) {
    throw new UnsupportedQueryError(
      `Entity '${entity}' is not permitted for querying`,
    );
  }

  // Validate metric field for numeric aggregates
  if (intent.metric === "SUM" || intent.metric === "AVG") {
    if (!intent.metricField) {
      throw new UnsupportedQueryError(
        `Metric '${intent.metric}' requires an explicit metricField`,
      );
    }
    const allowedNumeric = NUMERIC_FIELDS[entity] || [];
    if (!allowedNumeric.includes(intent.metricField)) {
      throw new UnsupportedQueryError(
        `Field '${intent.metricField}' cannot be used with metric '${intent.metric}' on entity '${entity}'`,
      );
    }
  }

  // Validate groupBy field
  if (intent.groupBy && !whitelist.has(intent.groupBy)) {
    throw new UnsupportedQueryError(
      `GroupBy field '${intent.groupBy}' is not a permitted column for entity '${entity}'`,
    );
  }

  const params: unknown[] = [];
  let paramIdx = 1;

  // Build WHERE conditions
  const whereClauses: string[] = ["1 = 1"];

  for (const filter of intent.filters) {
    if (!whitelist.has(filter.field)) {
      throw new UnsupportedQueryError(
        `Filter field '${filter.field}' is not permitted for entity '${entity}'`,
      );
    }

    switch (filter.operator) {
      case "EQUALS":
        whereClauses.push(`"${filter.field}" = $${paramIdx++}`);
        params.push(filter.value);
        break;
      case "NOT_EQUALS":
        whereClauses.push(`"${filter.field}" != $${paramIdx++}`);
        params.push(filter.value);
        break;
      case "GREATER_THAN":
        whereClauses.push(`"${filter.field}" > $${paramIdx++}`);
        params.push(filter.value);
        break;
      case "LESS_THAN":
        whereClauses.push(`"${filter.field}" < $${paramIdx++}`);
        params.push(filter.value);
        break;
      case "CONTAINS":
        whereClauses.push(`"${filter.field}"::text ILIKE $${paramIdx++}`);
        params.push(`%${filter.value}%`);
        break;
      case "IN":
        if (Array.isArray(filter.value) && filter.value.length > 0) {
          whereClauses.push(`"${filter.field}" = ANY($${paramIdx++})`);
          params.push(filter.value);
        }
        break;
    }
  }

  const whereSql = whereClauses.join(" AND ");

  // Build SELECT statement based on metric
  let selectClause = "";
  let groupByClause = "";

  if (intent.groupBy) {
    groupByClause = ` GROUP BY "${intent.groupBy}"`;
  }

  switch (intent.metric) {
    case "COUNT":
      if (intent.groupBy) {
        selectClause = `"${intent.groupBy}", count(*)::int as count`;
      } else {
        selectClause = `count(*)::int as total`;
      }
      break;

    case "SUM":
      if (intent.groupBy) {
        selectClause = `"${intent.groupBy}", coalesce(sum("${intent.metricField}"), 0) as total`;
      } else {
        selectClause = `coalesce(sum("${intent.metricField}"), 0) as total`;
      }
      break;

    case "AVG":
      if (intent.groupBy) {
        selectClause = `"${intent.groupBy}", coalesce(avg("${intent.metricField}"), 0) as average`;
      } else {
        selectClause = `coalesce(avg("${intent.metricField}"), 0) as average`;
      }
      break;

    case "LIST": {
      const allowedCols = Array.from(whitelist)
        .filter(
          (col) =>
            !["custom_data", "password_hash", "access_token"].includes(col),
        )
        .map((col) => `"${col}"`)
        .join(", ");
      selectClause = allowedCols;
      break;
    }
  }

  const limitClause = ` LIMIT $${paramIdx++}`;
  params.push(intent.limit);

  const sql = `SELECT ${selectClause} FROM "${entity}" WHERE ${whereSql}${groupByClause}${limitClause}`;

  return { sql, params, intent };
}

const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "EXEC",
  "EXECUTE",
  "COPY",
  "CALL",
  "DO",
  "VACUUM",
  "REINDEX",
];

const FORBIDDEN_SCHEMAS = ["PG_", "INFORMATION_SCHEMA", "PG_CATALOG"];

/**
 * Validates that an AI-generated SQL query is strictly read-only, non-mutating,
 * single-statement, and free of system-level intrusions.
 */
export function validateSafeReadOnlySql(sql: string): {
  safe: boolean;
  error?: string;
} {
  if (!sql || typeof sql !== "string") {
    return { safe: false, error: "SQL query must be a non-empty string" };
  }

  const cleanSql = sql.trim();

  // 1. Prevent statement chaining (no semicolons except optional one at the very end)
  const withoutTrailingSemicolon = cleanSql.endsWith(";")
    ? cleanSql.slice(0, -1)
    : cleanSql;
  if (withoutTrailingSemicolon.includes(";")) {
    return {
      safe: false,
      error:
        "Multiple statements separated by semicolons are strictly prohibited",
    };
  }

  // 2. Word boundary check for mutating keywords
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(cleanSql)) {
      return {
        safe: false,
        error: `Mutating or administrative keyword '${keyword}' is prohibited`,
      };
    }
  }

  // 3. Must start with SELECT or WITH
  const normalizedStart = cleanSql.toUpperCase();
  if (
    !normalizedStart.startsWith("SELECT") &&
    !normalizedStart.startsWith("WITH")
  ) {
    return {
      safe: false,
      error: "Query must be a read-only SELECT or WITH statement",
    };
  }

  // 4. Check for forbidden system catalogs
  const upperSql = cleanSql.toUpperCase();
  for (const schema of FORBIDDEN_SCHEMAS) {
    if (upperSql.includes(schema)) {
      return {
        safe: false,
        error: `Accessing system catalog '${schema}' is prohibited`,
      };
    }
  }

  return { safe: true };
}

/**
 * Enforces safety assertion, throwing SqlSafetyViolationError if unsafe.
 */
export function assertSafeReadOnlySql(sql: string): void {
  const result = validateSafeReadOnlySql(sql);
  if (!result.safe) {
    throw new SqlSafetyViolationError(result.error ?? "Unsafe SQL query");
  }
}
