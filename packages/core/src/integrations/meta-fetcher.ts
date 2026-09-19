import type { MetaLeadDetails } from "@business-os/types";

export interface MetaLeadFetcher {
  fetchLeadDetails(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<MetaLeadDetails>;
}

export class DefaultMetaLeadFetcher implements MetaLeadFetcher {
  async fetchLeadDetails(
    leadgenId: string,
    pageAccessToken: string,
  ): Promise<MetaLeadDetails> {
    const url = `https://graph.facebook.com/v21.0/${encodeURIComponent(leadgenId)}?access_token=${encodeURIComponent(pageAccessToken)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(
        `Failed to fetch Meta lead [${leadgenId}]: ${response.status} ${errText}`,
      );
    }
    return (await response.json()) as MetaLeadDetails;
  }
}
