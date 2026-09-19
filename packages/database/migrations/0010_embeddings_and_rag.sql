-- ==============================================================================
-- MIGRATION 0010: AI BRAIN & VECTOR KNOWLEDGE ENGINE (PGVECTOR RAG)
-- ==============================================================================

-- 1. Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Knowledge Documents (Source articles, brochures, policies, FAQs)
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  source_type VARCHAR(50) NOT NULL DEFAULT 'MANUAL', -- 'MANUAL', 'BROCHURE', 'POLICY', 'FAQ'
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_org_source ON knowledge_documents(organization_id, source_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_docs_org_created ON knowledge_documents(organization_id, created_at DESC);

-- 3. Document Chunks (Tokenized chunks with 1536-dimensional vector embeddings)
CREATE TABLE IF NOT EXISTS document_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}',
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_document_chunks_org_doc ON document_chunks(organization_id, document_id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_org ON document_chunks(organization_id);

-- 4. HNSW Index for ultra-fast approximate cosine similarity search
CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_hnsw 
ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) - ZERO LEAK INVARIANT
-- ==============================================================================

ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_knowledge_documents ON knowledge_documents;
CREATE POLICY tenant_isolation_knowledge_documents ON knowledge_documents
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_document_chunks ON document_chunks;
CREATE POLICY tenant_isolation_document_chunks ON document_chunks
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- ==============================================================================
-- 6. GRANT APP_USER PERMISSIONS
-- ==============================================================================

GRANT ALL PRIVILEGES ON TABLE knowledge_documents TO app_user;
GRANT ALL PRIVILEGES ON TABLE document_chunks TO app_user;
