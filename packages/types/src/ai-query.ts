import { z } from "zod";

export const QueryMetricSchema = z.enum(["COUNT", "SUM", "AVG", "LIST"]);
export type QueryMetric = z.infer<typeof QueryMetricSchema>;

export const QueryEntitySchema = z.enum([
  "leads",
  "units",
  "projects",
  "contracts",
  "reservations",
  "deals",
]);
export type QueryEntity = z.infer<typeof QueryEntitySchema>;

export const StructuredFilterConditionSchema = z.object({
  field: z.string().min(1).max(50),
  operator: z.enum([
    "EQUALS",
    "NOT_EQUALS",
    "GREATER_THAN",
    "LESS_THAN",
    "CONTAINS",
    "IN",
  ]),
  value: z.unknown(),
});
export type StructuredFilterCondition = z.infer<
  typeof StructuredFilterConditionSchema
>;

export const StructuredQueryIntentSchema = z.object({
  entity: QueryEntitySchema,
  metric: QueryMetricSchema,
  metricField: z.string().min(1).max(50).optional(),
  groupBy: z.string().min(1).max(50).optional(),
  filters: z.array(StructuredFilterConditionSchema).default([]),
  limit: z.number().int().min(1).max(100).default(50),
});
export type StructuredQueryIntent = z.infer<typeof StructuredQueryIntentSchema>;

export interface AskBusinessInput {
  question: string;
  conversationId?: string;
  maxRows?: number;
}

export interface GroundedSqlResult {
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
  intent?: StructuredQueryIntent;
}

export interface AskBusinessResponse {
  question: string;
  answerText: string;
  intentType:
    "RELATIONAL_QUERY" | "KNOWLEDGE_RETRIEVAL" | "HYBRID" | "UNSUPPORTED_QUERY";
  sqlQuery?: string;
  intent?: StructuredQueryIntent;
  data?: Record<string, unknown>[];
  knowledgeMatches?: Array<{
    title: string;
    content: string;
    similarity: number;
  }>;
  executionTimeMs: number;
}
