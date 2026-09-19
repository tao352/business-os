import type { WebhookVerificationQuery } from "@business-os/types";

export interface WebhookChallengeResult {
  isValid: boolean;
  challenge?: string;
}

/**
 * Handles Meta Webhook Verification Handshake (GET /webhook).
 * Meta sends `hub.mode`, `hub.verify_token`, and `hub.challenge`.
 * If valid, the challenge string must be returned directly in the response with 200 OK.
 */
export function verifyMetaWebhookChallenge(
  query: WebhookVerificationQuery,
  expectedVerifyToken: string,
): WebhookChallengeResult {
  const mode = query["hub.mode"];
  const token = query["hub.verify_token"];
  const challenge = query["hub.challenge"];

  if (mode === "subscribe" && token && token === expectedVerifyToken) {
    return {
      isValid: true,
      challenge: challenge || "",
    };
  }

  return {
    isValid: false,
  };
}
