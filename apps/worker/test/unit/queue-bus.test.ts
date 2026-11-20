import { describe, expect, it } from 'vitest';
import { QueueBus, type QueueLike } from '../../src/adapters/queues.js';
import type { PipelineMessage } from '../../src/pipeline/messages.js';

function fakeQueue() {
  const sent: { body: unknown; options?: unknown }[] = [];
  const batches: { body: unknown }[][] = [];
  const queue: QueueLike = {
    async send(body, options) {
      sent.push({ body, options });
    },
    async sendBatch(messages) {
      batches.push(messages);
    },
  };
  return { queue, sent, batches };
}

const fetchMsg = (page: number): PipelineMessage => ({
  v: 1,
  type: 'fetch',
  runId: 'r',
  profileIds: ['p'],
  queryKey: 'k',
  query: { keywords: 'k', location: null, radiusMiles: 25, employmentTypes: [], minSalary: null },
  page,
});
const processMsg = (jobId: string): PipelineMessage => ({
  v: 1,
  type: 'process',
  runId: 'r',
  jobId,
});

describe('QueueBus', () => {
  it('routes each message type to its own queue', async () => {
    const fetchQ = fakeQueue();
    const processQ = fakeQueue();
    const bus = new QueueBus({ fetch: fetchQ.queue, process: processQ.queue });

    await bus.send(fetchMsg(0));
    await bus.send(processMsg('j1'), { delaySeconds: 30 });

    expect(fetchQ.sent).toHaveLength(1);
    expect(processQ.sent).toEqual([{ body: processMsg('j1'), options: { delaySeconds: 30 } }]);
  });

  it('batches by queue and splits at the 100-message limit', async () => {
    const fetchQ = fakeQueue();
    const processQ = fakeQueue();
    const bus = new QueueBus({ fetch: fetchQ.queue, process: processQ.queue });

    const msgs = [
      ...Array.from({ length: 250 }, (_, i) => processMsg(`j${i}`)),
      fetchMsg(1),
      fetchMsg(2),
    ];
    await bus.sendBatch(msgs);

    expect(processQ.batches.map((b) => b.length)).toEqual([100, 100, 50]);
    expect(fetchQ.batches.map((b) => b.length)).toEqual([2]);
    expect(processQ.batches[0]?.[0]?.body).toEqual(processMsg('j0'));
  });

  it('sends nothing for an empty batch', async () => {
    const fetchQ = fakeQueue();
    const processQ = fakeQueue();
    await new QueueBus({ fetch: fetchQ.queue, process: processQ.queue }).sendBatch([]);
    expect(fetchQ.batches).toEqual([]);
    expect(processQ.batches).toEqual([]);
  });
});
