import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createApp } from '../server/app.js';

const distPath = path.resolve(process.argv[2] || 'dist');
assert.ok(fs.existsSync(path.join(distPath, 'index.html')), 'Run npm run build first.');
// Validate an ephemeral localhost server without touching saved games.
const server = createApp({ storePath: '', distPath });
try {
  const address = await server.listen(0, '127.0.0.1');
  const origin = `http://127.0.0.1:${address.port}`;
  const health = await fetch(`${origin}/api/health`);
  assert.equal(health.status, 200); assert.equal((await health.json()).ok, true);
  const page = await fetch(origin);
  assert.equal(page.status, 200);
  const html = await page.text(); assert.match(html, /<div id="root"><\/div>/);
  const script = html.match(/src="([^"]+\.js)"/)[1];
  assert.equal((await fetch(new URL(script, origin))).status, 200);
  console.log('OPENOPOLY production server, health endpoint and built UI passed.');
} finally { await server.close(); }
