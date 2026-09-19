export interface AskBusinessInput {
  question: string;
  conversationId?: string;
  maxRows?: number;
}

export interface GroundedSqlResult {
  sql: string;
  rowCount: number;
  rows: Record<string, unknown>[];
}

export interface AskBusinessResponse {
  question: string;
  answerText: string;
  intentType: "RELATIONAL_QUERY" | "KNOWLEDGE_RETRIEVAL" | "HYBRID";
  sqlQuery?: string;
  data?: Record<string, unknown>[];
  knowledgeMatches?: Array<{
    title: string;
    content: string;
    similarity: number;
  }>;
  executionTimeMs: number;
}
