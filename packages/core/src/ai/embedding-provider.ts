import type { EmbeddingProvider } from "@business-os/types";

/**
 * [TEST / OFFLINE ONLY] DeterministicEmbeddingProvider
 * Generates 1536-dimensional feature-hashed unit vectors for offline testing and CI.
 * NOT a semantic neural embedding model. In production, connect an external model provider
 * (e.g. OpenAI text-embedding-3-small, Google Vertex AI text-embedding-004, or Cohere).
 */
export class DeterministicEmbeddingProvider implements EmbeddingProvider {
  public readonly dimension = 1536;

  async generateEmbedding(text: string): Promise<number[]> {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "DeterministicEmbeddingProvider cannot be used in production. A live semantic embedding model must be configured.",
      );
    }

    const vector = new Array<number>(this.dimension).fill(0);
    const tokens = this.tokenize(text);

    if (tokens.length === 0) {
      vector[0] = 1.0;
      return vector;
    }

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      const hash = this.hashString(token);

      // Project token across multiple dimensions (feature hashing)
      for (let k = 0; k < 8; k++) {
        const dimIndex = Math.abs((hash * 31 + k * 97) % this.dimension);
        const sign = ((hash >> k) & 1) === 0 ? 1.0 : -1.0;
        const weight = 1.0;
        vector[dimIndex] = (vector[dimIndex] ?? 0) + sign * weight;
      }
    }

    // L2 Normalization to ensure ||vector|| = 1.0
    let norm = 0;
    for (let i = 0; i < this.dimension; i++) {
      norm += (vector[i] ?? 0) * (vector[i] ?? 0);
    }
    norm = Math.sqrt(norm);

    if (norm === 0) {
      vector[0] = 1.0;
      return vector;
    }

    for (let i = 0; i < this.dimension; i++) {
      vector[i] = (vector[i] ?? 0) / norm;
    }

    return vector;
  }

  async generateEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.generateEmbedding(t)));
  }

  private tokenize(text: string): string[] {
    const rawTokens = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const normalizedTokens: string[] = [];
    for (const raw of rawTokens) {
      normalizedTokens.push(raw);
      // Strip common Arabic prefixes (ال التعريف، واو العطف، باء الجر، إلخ)
      const stripped = raw
        .replace(/^(وال|فال|بال|كال|ولل|ال)/, "")
        .replace(/^[وبفلك]/, "");
      if (stripped.length >= 3 && stripped !== raw) {
        normalizedTokens.push(stripped);
      }
    }
    return normalizedTokens;
  }

  private hashString(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) + hash + str.charCodeAt(i);
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }
}

export const defaultEmbeddingProvider: EmbeddingProvider =
  new DeterministicEmbeddingProvider();
