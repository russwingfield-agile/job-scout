import type { BlobStore } from '../../src/ports/blob.js';
import type { DocParser } from '../../src/ports/docparse.js';

export class FakeBlobStore implements BlobStore {
  readonly objects = new Map<string, { body: ArrayBuffer; mime: string }>();

  async put(key: string, body: ArrayBuffer, mime: string): Promise<void> {
    this.objects.set(key, { body, mime });
  }

  async get(key: string): Promise<ArrayBuffer | null> {
    return this.objects.get(key)?.body ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}

/** Returns fixed text for any document, or fails when told to. */
export class FakeDocParser implements DocParser {
  readonly calls: { name: string; mime: string; size: number }[] = [];
  failWith: Error | null = null;

  constructor(public text: string) {}

  async toMarkdown(file: { name: string; bytes: ArrayBuffer; mime: string }): Promise<string> {
    this.calls.push({ name: file.name, mime: file.mime, size: file.bytes.byteLength });
    if (this.failWith) throw this.failWith;
    return this.text;
  }
}
