// Minimal static file server for local development and the browser tests (no dependencies).
// Usage: node scripts/serve.mjs [port]        Production uses nginx (see Dockerfile).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.argv[2] || process.env.PORT || 5180);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
};
// Only the app's own files are served; nothing else in the repository is reachable.
const PUBLIC = [/^\/index\.html$/, /^\/artifact\.html$/, /^\/css\/[\w.-]+\.css$/, /^\/js\/[\w.-]+\.js$/];

http.createServer(async (req, res) => {
  let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (pathname === '/') pathname = '/index.html';
  if (!PUBLIC.some(re => re.test(pathname))) { res.writeHead(404).end('Not found'); return; }
  try {
    const body = await fs.readFile(path.join(root, pathname));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(pathname)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, () => console.log(`Craftfolio dev server: http://localhost:${port}`));
