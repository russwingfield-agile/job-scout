import { app } from './http/app.js';

// Wiring only. Real scheduled/queue handling arrives in M5.
export default {
  fetch: app.fetch,

  async scheduled(controller: ScheduledController): Promise<void> {
    console.log(
      JSON.stringify({ stage: 'scheduled', msg: 'stub', scheduledTime: controller.scheduledTime }),
    );
  },

  async queue(batch: MessageBatch<unknown>): Promise<void> {
    console.log(
      JSON.stringify({
        stage: 'queue',
        msg: 'stub',
        queue: batch.queue,
        size: batch.messages.length,
      }),
    );
    batch.ackAll();
  },
} satisfies ExportedHandler<Env>;
