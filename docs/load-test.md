# Load test

Craftfolio does its work in the browser, so "load" has two parts: how fast the server hands out the static files, and how fast the in-browser logic runs as documents grow. Both were measured; the scripts are in `scripts/` so the numbers can be reproduced.

## Test machine

| | |
|---|---|
| CPU | AMD Ryzen AI 7 445, 12 logical cores |
| Memory | 31 GB |
| OS | Windows 11, Docker Desktop (WSL 2 backend, 12 CPUs, 15.3 GB) |
| Node.js | 26.13 |
| Server under test | The project's own image: `nginxinc/nginx-unprivileged:1.27-alpine`, default worker settings, gzip on |

The load generator ran on the same machine as the container, so it competes with nginx for CPU and the figures are a lower bound for the server.

## 1. Static file server

```bash
docker compose up -d --build
```

```bash
node scripts/load-test.mjs http://localhost:8090 --concurrency 50 --seconds 15
```

Each virtual user repeats one **page load**: `index.html`, then both stylesheets and all 13 JavaScript modules in parallel (16 requests, 54 KB gzipped), over keep-alive connections.

| Virtual users | Requests | Errors | Requests / s | Page loads / s | p50 | p95 | p99 | max |
|---|---|---|---|---|---|---|---|---|
| 10 | 54,400 | 0 | 3,618 | 226 | 19 ms | 34 ms | 52 ms | 102 ms |
| 50 | 63,568 | 0 | 4,188 | 262 | 83 ms | 163 ms | 237 ms | 345 ms |
| 200 | 76,208 | 0 | 4,910 | 307 | 321 ms | 467 ms | 501 ms | 545 ms |

Container memory during the runs: **12.6 MiB**. Image size: 74 MB.

### Reading the numbers

- **No errors at any level**, including 200 simultaneous users each fetching 15 files in parallel.
- **Throughput flattens at about 4,000–5,000 requests per second** while latency grows in proportion to the number of users. That pattern means requests are queueing, and the queue is mostly in the load generator: it is a single Node.js process sharing the CPU with nginx and Docker's network layer. The server's memory stayed flat.
- **What it means in practice:** a real visitor loads the app once and then works locally. About 250–300 full page loads per second is roughly 900,000 to 1,000,000 visits per hour from one small container. Returning visitors revalidate with ETags and receive `304` responses with no body.
- **Scaling out** needs no coordination: the server holds no state, so more containers behind a load balancer (or any CDN in front) multiply capacity.

### Not tested

- A separate load-generator machine and a real network (this was loopback through Docker Desktop).
- TLS, which would be terminated in front of the container.
- Long-duration soak. The server has nothing that can leak or grow: no sessions, no writes, a read-only filesystem.

## 2. In-browser logic

```bash
node scripts/bench.mjs
```

The core modules are plain JavaScript, so they are timed in Node (same V8 engine as Chrome). 200 runs each after warm-up.

| Operation | Median | p95 |
|---|---|---|
| Render a typical CV | 0.017 ms | 0.043 ms |
| Render a CV with 50 positions (the model's maximum) | 0.147 ms | 0.342 ms |
| Render a full-page cover letter | 0.015 ms | 0.026 ms |
| Coach a typical CV | 0.012 ms | 0.037 ms |
| Coach a CV with 50 positions | 0.160 ms | 0.370 ms |
| ATS check on a 50-position CV | 0.222 ms | 0.376 ms |
| Job match, long advert against a 50-position CV | 0.404 ms | 0.756 ms |
| Validate one document | 0.005 ms | 0.011 ms |
| Serialise 500 documents | 2.7 ms | 3.3 ms |
| Parse and validate 500 documents | 4.5 ms | 6.1 ms |
| Merge two 500-document libraries | 0.05 ms | 0.10 ms |

A typical CV is 1.9 KB as JSON and a full-page letter 3.3 KB. 500 documents are about 1.3 MB, a quarter of the usual 5 MB `localStorage` quota.

### Reading the numbers

- **Every keystroke** renders the page and re-runs the coach. Even at the model's maximum size that is about 0.3 ms of logic, against a 16 ms frame budget. The browser's own layout of the new markup costs more than the logic does.
- **Every save** re-reads, merges and writes the whole library. At 500 documents that is about 7 ms, and typing saves are debounced to at most one per 300 ms.
- The field and list limits in `data.js` (see [assumptions.md](assumptions.md) D1) are what keep these worst cases bounded.

## 3. PDF export

```bash
node scripts/measure-pdf.mjs
```

Headless Chromium, the full one-page letter in `tests/fixtures.js`, libraries already loaded.

| | |
|---|---|
| Build time | about 385 ms |
| File size | 162 KB (was 607 KB before the encoding change) |
| First export in a session | adds the one-time download of four libraries, about 630 KB uncompressed, cached by the browser afterwards |

The comparison of encoder settings is in [design-rationale.md](design-rationale.md) §4. A browser test fails the build if a one-page letter exceeds 200 KB.

## Known limit

The documents view draws a real, scaled A4 preview for every document. That is instant for tens of documents (assumption A2) and was not optimised for hundreds; the fix would be paging or cached thumbnails.
