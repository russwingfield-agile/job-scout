import type { BlobStore } from '../ports/blob.js';

/** The slice of an R2 bucket binding we use. */
export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

export class R2Blobs implements BlobStore {
  constructor(private readonly bucket: R2BucketLike) {}

  async put(key: string, body: ArrayBuffer, mime: string): Promise<void> {
    await this.bucket.put(key, body, { httpMetadata: { contentType: mime } });
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    const object = await this.bucket.get(key);
    return object ? object.arrayBuffer() : null;
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}
