import crypto from "node:crypto";

/**
 * Strongly-typed error class for WhatsApp Graph API calls.
 * Differentiates retryable rate-limits/server errors from permanent client/token errors,
 * and tracks ambiguous delivery status on post-dispatch network failures.
 */
export class WhatsAppApiError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly retryable: boolean,
    public readonly isAmbiguous: boolean = false,
    public readonly rawResponse?: unknown,
  ) {
    super(message);
    this.name = "WhatsAppApiError";
  }
}

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

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr: any) {
      const isTimeout =
        networkErr?.name === "TimeoutError" ||
        networkErr?.code === "ETIMEDOUT" ||
        networkErr?.code === "ECONNRESET" ||
        String(networkErr?.message).toLowerCase().includes("timeout");

      throw new WhatsAppApiError(
        networkErr?.message || "Network error during WhatsApp API dispatch",
        0,
        false,
        isTimeout,
        networkErr,
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(errText);
      } catch {
        parsedBody = errText;
      }

      const status = res.status;
      // 429 Rate Limit and 5xx Server Outages are retryable
      const retryable = status === 429 || (status >= 500 && status < 600);

      throw new WhatsAppApiError(
        `Failed to send WhatsApp template: ${status} ${errText}`,
        status,
        retryable,
        false,
        parsedBody,
      );
    }

    const data = (await res.json()) as any;
    const wamid = data?.messages?.[0]?.id;
    if (!wamid || typeof wamid !== "string") {
      throw new WhatsAppApiError(
        `Meta Graph API responded 200 OK but missing provider message ID in payload: ${JSON.stringify(data)}`,
        200,
        false, // terminal provider protocol error
        false, // non-ambiguous
        data,
      );
    }
    return { wamid };
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

    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    } catch (networkErr: any) {
      const isTimeout =
        networkErr?.name === "TimeoutError" ||
        networkErr?.code === "ETIMEDOUT" ||
        networkErr?.code === "ECONNRESET" ||
        String(networkErr?.message).toLowerCase().includes("timeout");

      throw new WhatsAppApiError(
        networkErr?.message || "Network error during WhatsApp API dispatch",
        0,
        false,
        isTimeout,
        networkErr,
      );
    }

    if (!res.ok) {
      const errText = await res.text();
      let parsedBody: unknown;
      try {
        parsedBody = JSON.parse(errText);
      } catch {
        parsedBody = errText;
      }

      const status = res.status;
      const retryable = status === 429 || (status >= 500 && status < 600);

      throw new WhatsAppApiError(
        `Failed to send WhatsApp text: ${status} ${errText}`,
        status,
        retryable,
        false,
        parsedBody,
      );
    }

    const data = (await res.json()) as any;
    const wamid = data?.messages?.[0]?.id;
    if (!wamid || typeof wamid !== "string") {
      throw new WhatsAppApiError(
        `Meta Graph API responded 200 OK but missing provider message ID in payload: ${JSON.stringify(data)}`,
        200,
        false, // terminal provider protocol error
        false, // non-ambiguous
        data,
      );
    }
    return { wamid };
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

  public nextError?: Error;

  async sendTemplate(
    phoneNumberId: string,
    _accessToken: string,
    recipientPhone: string,
    templateName: string,
    _languageCode?: string,
    variables?: string[],
  ): Promise<{ wamid: string }> {
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = undefined;
      throw err;
    }
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
    if (this.nextError) {
      const err = this.nextError;
      this.nextError = undefined;
      throw err;
    }
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
