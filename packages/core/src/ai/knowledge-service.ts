import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  KnowledgeDocument,
  IngestDocumentInput,
  VectorSearchInput,
  VectorSearchResult,
  EmbeddingProvider,
} from "@business-os/types";
import { assertPermission } from "../permissions/checker.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import { chunkText } from "./chunking-service.js";
import { defaultEmbeddingProvider } from "./embedding-provider.js";

export interface IngestDocumentResult {
  document: KnowledgeDocument;
  chunksCount: number;
}

/**
 * Ingests a knowledge base document, splits it into semantic chunks,
 * generates 1536-dimensional vector embeddings, and stores them in PostgreSQL with pgvector.
 */
export async function ingestKnowledgeDocument(
  context: TenantContext,
  input: IngestDocumentInput,
  embeddingProvider: EmbeddingProvider = defaultEmbeddingProvider,
): Promise<IngestDocumentResult> {
  assertPermission(context, "create", "knowledge");

  const sourceType = input.sourceType || "MANUAL";
  const metadata = input.metadata || {};

  return await withTenantContext(context.organizationId, async (tx) => {
    // 1. Create Knowledge Document Record
    const docRes = await tx.query<KnowledgeDocument>(
      `INSERT INTO knowledge_documents (
        organization_id, title, source_type, content, metadata
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *`,
      [
        context.organizationId,
        input.title.trim(),
        sourceType,
        input.content,
        JSON.stringify(metadata),
      ],
    );

    const document = docRes.rows[0];
    if (!document) {
      throw new Error("Failed to insert knowledge document");
    }

    // 2. Chunk text
    const chunks = chunkText(input.content, {
      chunkSize: input.chunkSize,
      chunkOverlap: input.chunkOverlap,
    });

    // 3. Generate embeddings
    const embeddings = await embeddingProvider.generateEmbeddings(chunks);

    // 4. Insert Document Chunks with Vector Embeddings
    for (let i = 0; i < chunks.length; i++) {
      const chunkContent = chunks[i]!;
      const embedding = embeddings[i]!;
      const vectorLiteral = `[${embedding.join(",")}]`;

      await tx.query(
        `INSERT INTO document_chunks (
          organization_id, document_id, chunk_index, content, metadata, embedding
        ) VALUES ($1, $2, $3, $4, $5, $6::vector)`,
        [
          context.organizationId,
          document.id,
          i,
          chunkContent,
          JSON.stringify({ ...metadata, chunk_index: i }),
          vectorLiteral,
        ],
      );
    }

    // 5. Audit Log
    await recordAuditLog(tx, context, {
      action: "CREATE",
      entityType: "knowledge_document",
      entityId: document.id,
      afterState: {
        id: document.id,
        title: document.title,
        sourceType: document.source_type,
        chunksCount: chunks.length,
      },
    });

    logger.info(
      {
        organizationId: context.organizationId,
        documentId: document.id,
        chunksCount: chunks.length,
      },
      "Successfully ingested knowledge document into vector store",
    );

    return {
      document,
      chunksCount: chunks.length,
    };
  });
}

/**
 * Searches the tenant's vector knowledge base using cosine similarity (<=>).
 */
export async function searchSimilarKnowledge(
  context: TenantContext,
  input: VectorSearchInput,
  embeddingProvider: EmbeddingProvider = defaultEmbeddingProvider,
): Promise<VectorSearchResult[]> {
  assertPermission(context, "read", "knowledge");

  const limit = input.limit ?? 5;
  const threshold = input.threshold ?? 0.0;
  const queryEmbedding = await embeddingProvider.generateEmbedding(input.query);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query<{
      chunk_id: string;
      document_id: string;
      document_title: string;
      source_type: string;
      content: string;
      metadata: Record<string, unknown>;
      similarity: number;
    }>(
      `SELECT 
        c.id AS chunk_id,
        c.document_id,
        d.title AS document_title,
        d.source_type,
        c.content,
        c.metadata,
        (1 - (c.embedding <=> $2::vector)) AS similarity
       FROM document_chunks c
       JOIN knowledge_documents d ON c.document_id = d.id
       WHERE c.organization_id = $1
         AND ($4::varchar IS NULL OR d.source_type = $4)
         AND (1 - (c.embedding <=> $2::vector)) >= $5
       ORDER BY c.embedding <=> $2::vector ASC
       LIMIT $3`,
      [
        context.organizationId,
        vectorLiteral,
        limit,
        input.filterSourceType ?? null,
        threshold,
      ],
    );

    return res.rows.map((row) => ({
      chunkId: row.chunk_id,
      documentId: row.document_id,
      documentTitle: row.document_title,
      sourceType: row.source_type,
      content: row.content,
      similarity: Number(row.similarity),
      metadata: row.metadata || {},
    }));
  });
}

/**
 * Deletes a knowledge document and all its embedded chunks.
 */
export async function deleteKnowledgeDocument(
  context: TenantContext,
  documentId: string,
): Promise<boolean> {
  assertPermission(context, "delete", "knowledge");

  return await withTenantContext(context.organizationId, async (tx) => {
    const res = await tx.query(
      `DELETE FROM knowledge_documents WHERE id = $1 AND organization_id = $2 RETURNING id`,
      [documentId, context.organizationId],
    );

    if (res.rowCount && res.rowCount > 0) {
      await recordAuditLog(tx, context, {
        action: "DELETE",
        entityType: "knowledge_document",
        entityId: documentId,
      });
      return true;
    }

    return false;
  });
}

/**
 * Lists knowledge documents for the tenant.
 */
export async function listKnowledgeDocuments(
  context: TenantContext,
  filters: { sourceType?: string; limit?: number } = {},
): Promise<KnowledgeDocument[]> {
  assertPermission(context, "read", "knowledge");

  return await withTenantContext(context.organizationId, async (tx) => {
    const limit = filters.limit ?? 50;
    const res = await tx.query<KnowledgeDocument>(
      `SELECT * FROM knowledge_documents
       WHERE organization_id = $1
         AND ($2::varchar IS NULL OR source_type = $2)
       ORDER BY created_at DESC
       LIMIT $3`,
      [context.organizationId, filters.sourceType ?? null, limit],
    );
    return res.rows;
  });
}
