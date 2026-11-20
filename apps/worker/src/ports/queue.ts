import type { PipelineMessage } from '../pipeline/messages.js';

/** Sends pipeline work to the right queue. */
export interface Bus {
  send(msg: PipelineMessage, opts?: { delaySeconds?: number }): Promise<void>;
  sendBatch(msgs: PipelineMessage[]): Promise<void>;
}
