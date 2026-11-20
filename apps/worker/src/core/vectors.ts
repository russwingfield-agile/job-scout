/** Embedding vectors stored as text: Float32 bytes, base64-encoded (≈4 KB for 768 dimensions). */
export function encodeVector(values: number[]): string {
  const bytes = new Uint8Array(new Float32Array(values).buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeVector(encoded: string): number[] {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return Array.from(new Float32Array(bytes.buffer));
}

/** Cosine similarity in [-1, 1]; 0 if either vector has no length. Vectors must be the same size. */
export function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector length mismatch: ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const [i, x] of a.entries()) {
    const y = b[i] as number;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  return normA === 0 || normB === 0 ? 0 : dot / Math.sqrt(normA * normB);
}
