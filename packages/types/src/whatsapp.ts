export interface WhatsAppIntegration {
  id: string;
  organizationId: string;
  phoneNumberId: string;
  wabaId: string;
  phoneNumber?: string | null;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  isActive: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface ConfigureWhatsAppInput {
  phoneNumberId: string;
  wabaId: string;
  phoneNumber?: string;
  accessToken: string;
  appSecret: string;
  verifyToken: string;
  isActive?: boolean;
}

export type WhatsAppMessageDirection = "INBOUND" | "OUTBOUND";
export type WhatsAppMessageType = "text" | "template" | "interactive";
export type WhatsAppMessageStatus = "SENT" | "DELIVERED" | "READ" | "FAILED";

export interface WhatsAppMessageRecord {
  id: string;
  organizationId: string;
  wamid: string;
  leadId?: string | null;
  direction: WhatsAppMessageDirection;
  senderPhone: string;
  recipientPhone: string;
  messageType: WhatsAppMessageType;
  body?: string | null;
  status: WhatsAppMessageStatus;
  createdAt: Date | string;
}

export interface SendWhatsAppTemplateInput {
  phoneNumberId: string;
  recipientPhone: string;
  templateName: string;
  languageCode?: string;
  variables?: string[];
  leadId?: string;
}

export interface SendWhatsAppTextInput {
  phoneNumberId: string;
  recipientPhone: string;
  text: string;
  leadId?: string;
}

export interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
}

export interface WhatsAppWebhookStatus {
  id: string;
  status: "sent" | "delivered" | "read" | "failed";
  timestamp: string;
  recipient_id: string;
}

export interface WhatsAppWebhookChangeValue {
  messaging_product: "whatsapp";
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  messages?: WhatsAppWebhookMessage[];
  statuses?: WhatsAppWebhookStatus[];
}

export interface WhatsAppWebhookChange {
  field: "messages";
  value: WhatsAppWebhookChangeValue;
}

export interface WhatsAppWebhookEntry {
  id: string;
  changes: WhatsAppWebhookChange[];
}

export interface WhatsAppWebhookPayload {
  object: "whatsapp_business_account";
  entry: WhatsAppWebhookEntry[];
}
