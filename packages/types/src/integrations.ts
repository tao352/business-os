export interface MetaIntegration {
  id: string;
  organizationId: string;
  pageId: string;
  pageName?: string | null;
  pageAccessToken: string;
  appSecret: string;
  verifyToken: string;
  isActive: boolean;
  fieldMappings?: Record<string, string>;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ConfigureMetaIntegrationInput {
  pageId: string;
  pageName?: string;
  pageAccessToken: string;
  appSecret: string;
  verifyToken: string;
  isActive?: boolean;
  fieldMappings?: Record<string, string>;
}

export interface WebhookVerificationQuery {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export interface MetaFieldData {
  name: string;
  values: string[];
}

export interface MetaLeadDetails {
  id: string;
  created_time?: string;
  ad_id?: string | null;
  ad_name?: string | null;
  adset_id?: string | null;
  adset_name?: string | null;
  campaign_id?: string | null;
  campaign_name?: string | null;
  form_id?: string | null;
  form_name?: string | null;
  platform?: string | null;
  field_data: MetaFieldData[];
}

export interface MetaWebhookChangeValue {
  leadgen_id: string;
  page_id: string;
  form_id?: string;
  ad_id?: string;
  adgroup_id?: string;
  created_time?: number;
}

export interface MetaWebhookChange {
  field: string;
  value: MetaWebhookChangeValue;
}

export interface MetaWebhookEntry {
  id: string; // page_id
  time: number;
  changes: MetaWebhookChange[];
}

export interface MetaWebhookPayload {
  object: string; // usually 'page'
  entry: MetaWebhookEntry[];
}

export interface WebhookEventRecord {
  id: string;
  organizationId: string;
  provider: "META" | string;
  eventId: string;
  payload: unknown;
  status: "PENDING" | "PROCESSED" | "FAILED" | "DUPLICATE";
  errorMessage?: string | null;
  leadId?: string | null;
  processedAt?: Date | string | null;
  createdAt: Date | string;
}

export interface ParsedMetaLead {
  fullName: string;
  phone: string;
  email?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  formId?: string | null;
  formName?: string | null;
  platform?: string | null;
  customQuestions: Record<string, unknown>;
  rawFieldData: MetaFieldData[];
}

export interface MetaIngestionResult {
  success: boolean;
  action: "CREATED" | "UPDATED" | "DUPLICATE_IGNORED";
  leadId?: string;
  leadgenId: string;
  pageId: string;
  message?: string;
}
