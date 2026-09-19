import crypto from "node:crypto";

export interface WhatsAppApiClient {
  sendTemplate(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    templateName: string,
    languageCode?: string,
    variables?: string[],
  ): Promise<{ wamid: string }>;

  sendText(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    text: string,
  ): Promise<{ wamid: string }>;
}

export class DefaultWhatsAppApiClient implements WhatsAppApiClient {
  async sendTemplate(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    templateName: string,
    languageCode = "en",
    variables: string[] = [],
  ): Promise<{ wamid: string }> {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
    const components =
      variables.length > 0
        ? [
            {
              type: "body",
              parameters: variables.map((v) => ({ type: "text", text: v })),
            },
          ]
        : [];

    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to send WhatsApp template: ${res.status} ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      wamid:
        data.messages?.[0]?.id ||
        `wamid.${crypto.randomBytes(8).toString("hex")}`,
    };
  }

  async sendText(
    phoneNumberId: string,
    accessToken: string,
    recipientPhone: string,
    text: string,
  ): Promise<{ wamid: string }> {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`;
    const body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientPhone,
      type: "text",
      text: { body: text },
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to send WhatsApp text: ${res.status} ${err}`);
    }

    const data = (await res.json()) as any;
    return {
      wamid:
        data.messages?.[0]?.id ||
        `wamid.${crypto.randomBytes(8).toString("hex")}`,
    };
  }
}

export class MockWhatsAppApiClient implements WhatsAppApiClient {
  public sentTemplates: Array<{
    phoneNumberId: string;
    recipientPhone: string;
    templateName: string;
    variables?: string[];
    wamid: string;
  }> = [];

  public sentTexts: Array<{
    phoneNumberId: string;
    recipientPhone: string;
    text: string;
    wamid: string;
  }> = [];

  async sendTemplate(
    phoneNumberId: string,
    _accessToken: string,
    recipientPhone: string,
    templateName: string,
    _languageCode?: string,
    variables?: string[],
  ): Promise<{ wamid: string }> {
    const wamid = `wamid.HBgM${crypto.randomBytes(8).toString("hex")}`;
    this.sentTemplates.push({
      phoneNumberId,
      recipientPhone,
      templateName,
      variables,
      wamid,
    });
    return { wamid };
  }

  async sendText(
    phoneNumberId: string,
    _accessToken: string,
    recipientPhone: string,
    text: string,
  ): Promise<{ wamid: string }> {
    const wamid = `wamid.HBgM${crypto.randomBytes(8).toString("hex")}`;
    this.sentTexts.push({
      phoneNumberId,
      recipientPhone,
      text,
      wamid,
    });
    return { wamid };
  }
}
