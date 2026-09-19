export interface ChunkingOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

/**
 * Splits text into overlapping sliding-window chunks for vector embedding and retrieval.
 * Respects paragraph boundaries when possible, falling back to sentence and word boundaries.
 */
export function chunkText(
  text: string,
  options: ChunkingOptions = {},
): string[] {
  const chunkSize = options.chunkSize ?? 500;
  const chunkOverlap = options.chunkOverlap ?? 50;

  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleanText = text.trim();
  if (cleanText.length <= chunkSize) {
    return [cleanText];
  }

  const chunks: string[] = [];
  let startIndex = 0;

  while (startIndex < cleanText.length) {
    let endIndex = startIndex + chunkSize;

    if (endIndex >= cleanText.length) {
      const lastChunk = cleanText.substring(startIndex).trim();
      if (lastChunk.length > 0) {
        chunks.push(lastChunk);
      }
      break;
    }

    // Try finding a natural break point (paragraph or sentence) within the lookback window
    const lookback = cleanText.substring(startIndex, endIndex);
    const lastParagraph = lookback.lastIndexOf("\n\n");
    const lastSentence = Math.max(
      lookback.lastIndexOf(". "),
      lookback.lastIndexOf("! "),
      lookback.lastIndexOf("? "),
    );
    const lastSpace = lookback.lastIndexOf(" ");

    let cutIndex = endIndex;
    if (lastParagraph > chunkSize * 0.5) {
      cutIndex = startIndex + lastParagraph + 2;
    } else if (lastSentence > chunkSize * 0.5) {
      cutIndex = startIndex + lastSentence + 2;
    } else if (lastSpace > chunkSize * 0.5) {
      cutIndex = startIndex + lastSpace + 1;
    }

    const chunk = cleanText.substring(startIndex, cutIndex).trim();
    if (chunk.length > 0) {
      chunks.push(chunk);
    }

    // Move start forward, respecting overlap
    startIndex = Math.max(startIndex + 1, cutIndex - chunkOverlap);
  }

  return chunks;
}
