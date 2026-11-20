// Records a real Reed API response as a test fixture.
//
//   node scripts/record-reed-fixture.mjs search <name> key=value [key=value ...]
//   node scripts/record-reed-fixture.mjs details <name> <jobId>
//
// The key comes from $REED_API_KEY or apps/worker/.dev.vars (gitignored); it is never written to a
// fixture. Output: apps/worker/test/fixtures/reed/real/<name>.json. Adverts are public, but check
// a fixture for personal contact details before committing it.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://www.reed.co.uk/api/1.0';

function apiKey() {
  if (process.env.REED_API_KEY) return process.env.REED_API_KEY;
  const vars = readFileSync(join(root, 'apps/worker/.dev.vars'), 'utf8');
  const line = vars.split(/\r?\n/).find((l) => l.startsWith('REED_API_KEY='));
  if (!line) throw new Error('REED_API_KEY not set (env or apps/worker/.dev.vars)');
  return line.slice('REED_API_KEY='.length).trim();
}

const [kind, name, ...rest] = process.argv.slice(2);
if (!['search', 'details'].includes(kind) || !name) {
  console.error('usage: record-reed-fixture.mjs search|details <name> ...');
  process.exit(2);
}

const url =
  kind === 'search'
    ? `${BASE}/search?${new URLSearchParams(rest.map((kv) => kv.split(/=(.*)/s).slice(0, 2)))}`
    : `${BASE}/jobs/${encodeURIComponent(rest[0])}`;

const res = await fetch(url, {
  headers: { Authorization: `Basic ${Buffer.from(`${apiKey()}:`).toString('base64')}` },
  signal: AbortSignal.timeout(15_000),
});
if (!res.ok) {
  console.error(`Reed returned HTTP ${res.status}`);
  process.exit(1);
}
const body = await res.json();

const out = join(root, 'apps/worker/test/fixtures/reed/real', `${name}.json`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
console.log(`wrote ${out}`);
