export class SqlSafetyViolationError extends Error {
  constructor(message: string) {
    super(`SQL Safety Violation: ${message}`);
    this.name = "SqlSafetyViolationError";
  }
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
