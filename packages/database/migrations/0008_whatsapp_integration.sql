-- ==============================================================================
-- MIGRATION 0008: WHATSAPP CLOUD API INTEGRATION (TWO-WAY MESSAGING & TEMPLATES)
-- ==============================================================================

-- 1. WhatsApp Integrations (Tenant WhatsApp Business Account Credentials)
CREATE TABLE IF NOT EXISTS whatsapp_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  phone_number_id VARCHAR(100) NOT NULL,
  waba_id VARCHAR(100) NOT NULL,
  phone_number VARCHAR(50),
  access_token TEXT NOT NULL,
  app_secret VARCHAR(255) NOT NULL,
  verify_token VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, phone_number_id)
);

CREATE INDEX IF NOT EXISTS idx_wa_int_org_phone ON whatsapp_integrations(organization_id, phone_number_id);
CREATE INDEX IF NOT EXISTS idx_wa_int_phone_number_id ON whatsapp_integrations(phone_number_id);

-- 2. WhatsApp Messages (Full message history, WAMID tracking & delivery statuses)
CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  wamid VARCHAR(255) NOT NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  direction VARCHAR(20) NOT NULL, -- 'INBOUND', 'OUTBOUND'
  sender_phone VARCHAR(50) NOT NULL,
  recipient_phone VARCHAR(50) NOT NULL,
  message_type VARCHAR(50) NOT NULL DEFAULT 'text', -- 'text', 'template', 'interactive'
  body TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'SENT', -- 'SENT', 'DELIVERED', 'READ', 'FAILED'
  raw_payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, wamid)
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_org_lead ON whatsapp_messages(organization_id, lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_msg_org_wamid ON whatsapp_messages(organization_id, wamid);

-- ==============================================================================
-- 3. ENABLE ROW-LEVEL SECURITY (RLS) ON ALL TABLES
-- ==============================================================================

-- WhatsApp Integrations RLS
ALTER TABLE whatsapp_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_integrations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_whatsapp_integrations ON whatsapp_integrations;
CREATE POLICY tenant_isolation_whatsapp_integrations ON whatsapp_integrations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- WhatsApp Messages RLS
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_whatsapp_messages ON whatsapp_messages;
CREATE POLICY tenant_isolation_whatsapp_messages ON whatsapp_messages
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

-- Grant privileges to application user role
GRANT ALL PRIVILEGES ON TABLE whatsapp_integrations TO app_user;
GRANT ALL PRIVILEGES ON TABLE whatsapp_messages TO app_user;
