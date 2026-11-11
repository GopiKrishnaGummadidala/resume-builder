// HTTP load test for the static server (no dependencies).
// Usage: node scripts/load-test.mjs [baseUrl] [--concurrency 50] [--seconds 15]
// Each virtual user repeatedly performs one "page load": index.html, both stylesheets and every JS module.
import fs from 'node:fs';
import http from 'node:http';
import { performance } from 'node:perf_hooks';

const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : Number(args[i + 1]); };
const base = new URL(args.find(a => /^https?:/.test(a)) || 'http://localhost:8090');
const concurrency = flag('concurrency', 50);
const seconds = flag('seconds', 15);

const modules = fs.readdirSync(new URL('../js/', import.meta.url)).filter(f => f.endsWith('.js') && f !== 'profile.local.js' && f !== 'profile.example.js');
const paths = ['/', '/css/styles.css', '/css/templates.css', ...modules.map(m => `/js/${m}`)];

const agent = new http.Agent({ keepAlive: true, maxSockets: concurrency });
const latencies = [];
let bytes = 0, errors = 0, requests = 0, pageLoads = 0;

function get(path) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const req = http.get({ host: base.hostname, port: base.port || 80, path, agent, headers: { 'Accept-Encoding': 'gzip' } }, res => {
      res.on('data', chunk => { bytes += chunk.length; });
      res.on('end', () => {
        requests++;
        if (res.statusCode !== 200) errors++;
        latencies.push(performance.now() - t0);
        resolve();
      });
    });
    req.on('error', () => { requests++; errors++; resolve(); });
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });
}

const deadline = performance.now() + seconds * 1000;
async function user() {
  while (performance.now() < deadline) {
    await get(paths[0]);                              // the page first...
    await Promise.all(paths.slice(1).map(get));       // ...then its assets in parallel, like a browser
    pageLoads++;
  }
}

console.log(`Load test: ${base.origin}  users=${concurrency}  duration=${seconds}s  files per page load=${paths.length}`);
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, user));
const elapsed = (performance.now() - started) / 1000;
agent.destroy();

latencies.sort((a, b) => a - b);
const pct = p => latencies[Math.min(latencies.length - 1, Math.floor((p / 100) * latencies.length))]?.toFixed(1) ?? 'n/a';
console.table({
  'requests': requests,
  'errors': errors,
  'requests / second': Math.round(requests / elapsed),
  'page loads / second': Math.round(pageLoads / elapsed),
  'latency p50 (ms)': pct(50),
  'latency p95 (ms)': pct(95),
  'latency p99 (ms)': pct(99),
  'latency max (ms)': latencies.at(-1)?.toFixed(1) ?? 'n/a',
  'transferred (MB)': (bytes / 1024 / 1024).toFixed(1),
  'KB per page load (gzip)': pageLoads ? (bytes / 1024 / pageLoads).toFixed(1) : 'n/a',
});
process.exit(errors ? 1 : 0);
