export interface DocParser {
  /** PDF/DOCX → Markdown text. Throws if the document cannot be converted. */
  toMarkdown(file: { name: string; bytes: ArrayBuffer; mime: string }): Promise<string>;
}
