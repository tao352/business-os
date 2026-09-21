import { withTenantContext } from "@business-os/database";
import type {
  TenantContext,
  HybridContext,
  EmbeddingProvider,
} from "@business-os/types";
import { searchSimilarKnowledge } from "./knowledge-service.js";
import { defaultEmbeddingProvider } from "./embedding-provider.js";

export interface RetrieveGroundedContextOptions {
  leadId?: string;
  unitId?: string;
  limit?: number;
  threshold?: number;
  filterSourceType?: string;
  embeddingProvider?: EmbeddingProvider;
}

/**
 * Hybrid Retriever combines pgvector semantic similarity search with real-time
 * CRM operational entity data (Leads, Units, Projects) to generate grounded RAG context.
 */
export async function retrieveGroundedContext(
  context: TenantContext,
  query: string,
  options: RetrieveGroundedContextOptions = {},
): Promise<HybridContext> {
  // 1. Semantic Knowledge Search
  const knowledgeMatches = await searchSimilarKnowledge(
    context,
    {
      query,
      limit: options.limit ?? 5,
      threshold: options.threshold ?? 0.0,
      filterSourceType: options.filterSourceType,
    },
    options.embeddingProvider ?? defaultEmbeddingProvider,
  );

  const crmContext: HybridContext["crmContext"] = {};

  // 2. Fetch Live CRM Data if entity IDs are provided
  if (options.leadId || options.unitId) {
    await withTenantContext(context.organizationId, async (tx) => {
      if (options.leadId) {
        const leadRes = await tx.query(
          `SELECT id, full_name, phone, email, status, source, custom_data, created_at
           FROM leads
           WHERE id = $1 AND organization_id = $2`,
          [options.leadId, context.organizationId],
        );
        crmContext.lead = leadRes.rows[0] ?? null;
      }

      if (options.unitId) {
        const unitRes = await tx.query(
          `SELECT u.id, u.unit_number, u.usage_type, u.unit_type, u.model_name, u.floor,
                  u.price, u.status, u.gross_area,
                  p.name AS project_name, p.location AS project_location
           FROM units u
           LEFT JOIN projects p ON u.project_id = p.id
           WHERE u.id = $1 AND u.organization_id = $2`,
          [options.unitId, context.organizationId],
        );
        crmContext.unit = unitRes.rows[0] ?? null;
      }
    });
  }

  return {
    query,
    knowledgeMatches,
    crmContext,
  };
}
