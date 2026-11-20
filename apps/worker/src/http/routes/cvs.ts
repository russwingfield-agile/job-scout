import { type ApiErrorResponse, UpdateCvRequestSchema } from '@job-scout/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { AppError } from '../../lib/errors.js';
import {
  createCv,
  deleteCv,
  getCv,
  listCvs,
  reanalyseCv,
  updateCv,
} from '../../pipeline/cvService.js';
import type { AppEnv } from '../types.js';
import { validate } from '../validate.js';

/**
 * Hard cap on the request body, to protect Worker memory before the file is read. The real,
 * configurable limit (settings.cvs.maxUploadBytes, default 5 MB) is enforced by the service; this
 * only needs to be comfortably above it.
 */
const UPLOAD_BODY_LIMIT_BYTES = 16 * 1024 * 1024;

export const cvsRoute = new Hono<AppEnv>()
  .get('/', async (c) => c.json(await listCvs(c.var.deps)))
  .get('/:id', async (c) => c.json(await getCv(c.var.deps, c.req.param('id'))))
  .post(
    '/',
    bodyLimit({
      maxSize: UPLOAD_BODY_LIMIT_BYTES,
      onError: (c) => {
        const body: ApiErrorResponse = {
          error: {
            code: 'VALIDATION',
            message: 'The upload is too large.',
            requestId: c.get('requestId'),
          },
        };
        return c.json(body, 413);
      },
    }),
    async (c) => {
      const form = await c.req.parseBody();
      const file = form.file;
      if (!(file instanceof File)) {
        throw new AppError('VALIDATION', 'Attach a PDF or DOCX file in the "file" field.');
      }
      const label = typeof form.label === 'string' ? form.label : undefined;
      const result = await createCv(c.var.deps, {
        filename: file.name,
        mime: file.type,
        bytes: await file.arrayBuffer(),
        label,
      });
      return c.json(result, 201);
    },
  )
  .patch('/:id', validate('json', UpdateCvRequestSchema), async (c) =>
    c.json(await updateCv(c.var.deps, c.req.param('id'), c.req.valid('json'))),
  )
  .post('/:id/analyse', async (c) => c.json(await reanalyseCv(c.var.deps, c.req.param('id'))))
  .delete('/:id', async (c) => {
    await deleteCv(c.var.deps, c.req.param('id'));
    return c.body(null, 204);
  });
