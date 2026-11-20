export type LlmRequest = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  temperature?: number | undefined;
  /** JSON Schema the output must satisfy (JSON mode). */
  jsonSchema?: object | undefined;
};

export type LlmResponse = {
  text: string;
  /** Token counts when the provider reports them. */
  usage?: { in: number; out: number } | undefined;
};

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}
