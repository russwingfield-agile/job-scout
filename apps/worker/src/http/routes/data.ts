import { DeleteAllDataRequestSchema, type DeleteAllDataResponse } from '@job-scout/shared';
import { Hono } from 'hono';
import { AppError } from '../../lib/errors.js';
import { deleteAllData } from '../../pipeline/deleteAll.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

/** The phrase that must be typed to delete everything. */
export const DELETE_ALL_PHRASE = 'DELETE EVERYTHING';

export const dataRoute = new Hono<AppEnv>().delete(
  '/',
  validate('json', DeleteAllDataRequestSchema),
  async (c) => {
    const deps = c.var.deps;
    if (c.req.valid('json').confirm !== DELETE_ALL_PHRASE) {
      throw new AppError('VALIDATION', `Type ${DELETE_ALL_PHRASE} to confirm.`, {
        issues: [{ path: 'confirm', message: 'Does not match' }],
      });
    }
    if (await deps.repos.runs.findActive()) {
      throw new AppError(
        'CONFLICT',
        'A run is in progress. Wait for it to finish, then try again.',
      );
    }
    const body: DeleteAllDataResponse = await deleteAllData(deps);
    return c.json(body);
  },
);
