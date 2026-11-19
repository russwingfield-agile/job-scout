import type { Deps } from '../container.js';

export type AppEnv = {
  Bindings: Env;
  Variables: { deps: Deps; requestId: string };
};
