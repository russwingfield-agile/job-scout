export interface BlobStore {
  put(key: string, body: ArrayBuffer, mime: string): Promise<void>;
  get(key: string): Promise<ArrayBuffer | null>;
  delete(key: string): Promise<void>;
}
