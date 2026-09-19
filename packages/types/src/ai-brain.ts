import { z } from "zod";

export const SourceTypeSchema = z.enum([
  "MANUAL",
  "BROCHURE",
  "POLICY",
  "FAQ",
  "WHATSAPP_SCRIPT",
]);
export type SourceType = z.infer<typeof SourceTypeSchema>;

export interface KnowledgeDocument {
  id: string;
  organization_id: string;
  title: string;
  source_type: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface DocumentChunk {
  id: string;
  organization_id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  embedding?: number[];
  created_at: Date;
}

export interface IngestDocumentInput {
  title: string;
  sourceType?: string;
  content: string;
  metadata?: Record<string, unknown>;
  chunkSize?: number;
  chunkOverlap?: number;
}

export interface VectorSearchInput {
  query: string;
  limit?: number;
  threshold?: number;
  filterSourceType?: string;
}

export interface VectorSearchResult {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  sourceType: string;
  content: string;
  similarity: number;
  metadata: Record<string, unknown>;
}

export interface HybridContext {
  query: string;
  knowledgeMatches: VectorSearchResult[];
  crmContext?: {
    lead?: Record<string, unknown> | null;
    unit?: Record<string, unknown> | null;
    deal?: Record<string, unknown> | null;
  };
}

export interface EmbeddingProvider {
  dimension: number;
  generateEmbedding(text: string): Promise<number[]>;
  generateEmbeddings(texts: string[]): Promise<number[][]>;
}
