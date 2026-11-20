import { createContainer } from './container.js';
import { app } from './http/app.js';
import { handleMessage } from './pipeline/consume.js';
import { runScheduled } from './pipeline/scheduled.js';

// Wiring only: all behaviour lives in pipeline/ and http/.
export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await runScheduled(createContainer(env));
  },

  /**
   * Each message is handled independently: one failing message never affects the rest of its batch.
   * `attempts` is 1 on first delivery (see QUEUE_MAX_RETRIES for how many retries follow).
   */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const deps = createContainer(env);
    await Promise.allSettled(
      batch.messages.map(async (message) => {
        try {
          const result = await handleMessage(deps, message.body, message.attempts);
          if (result.outcome === 'ack') message.ack();
          else message.retry({ delaySeconds: result.delaySeconds });
        } catch (err) {
          // handleMessage should not throw; if it does, let the queue redeliver.
          deps.log.error({
            stage: 'queue',
            msg: 'unhandled error in message handler',
            error: err instanceof Error ? err.message : String(err),
          });
          message.retry();
        }
      }),
    );
  },
} satisfies ExportedHandler<Env>;
