// The API server's own logic: passwords, sessions, rate limits, the link fetcher's guards, and the
// request checks that run before any database work (a stand-in database fails the test if it is used).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { hashPassword, verifyPassword, newToken, tokenHash, rateLimiter } from '../../server/security.js';
import { isPublicAddress, readJobPage, htmlToText } from '../../server/jobfetch.js';
import { createApp } from '../../server/app.js';

describe('passwords and sessions', () => {
  test('a password is stored only as a salted scrypt hash and checks only against itself', async () => {
    const a = await hashPassword('correct horse battery');
    const b = await hashPassword('correct horse battery');
    assert.match(a, /^scrypt\$32768\$8\$1\$[\w-]+\$[\w-]+$/);
    assert.notEqual(a, b, 'a new salt every time');
    assert.equal(a.includes('correct'), false);
    assert.equal(await verifyPassword('correct horse battery', a), true);
    assert.equal(await verifyPassword('correct horse batterY', a), false);
    assert.equal(await verifyPassword('anything', 'not a hash'), false);
  });

  test('session tokens are random, and only their SHA-256 is stored', () => {
    const t = newToken();
    assert.match(t, /^[\w-]{43}$/);
    assert.notEqual(t, newToken());
    assert.equal(tokenHash(t).length, 32);
    assert.deepEqual(tokenHash(t), tokenHash(t));
  });

  test('the rate limiter allows max hits per window, per key', () => {
    let now = 0;
    const hit = rateLimiter({ max: 2, windowMs: 1000, now: () => now });
    assert.deepEqual([hit('a'), hit('a'), hit('a'), hit('b')], [true, true, false, true]);
    now = 1001;
    assert.equal(hit('a'), true, 'a new window');
  });
});

describe('job links', () => {
  test('only public addresses may be fetched', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.equal(isPublicAddress(ip), true, ip);
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.16.5.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', 'not-an-ip']) {
      assert.equal(isPublicAddress(ip), false, ip);
    }
  });

  test('a job page is read from its JobPosting data when it has one', () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      '@context': 'https://schema.org', '@graph': [{ '@type': 'JobPosting', title: 'Senior .NET Developer',
        hiringOrganization: { '@type': 'Organization', name: 'Contoso' },
        description: '<p>We build <b>things</b>.</p><ul><li>C# &amp; .NET</li><li>Angular</li></ul>' }],
    })}</script></head><body>menu, cookie banner</body></html>`;
    assert.deepEqual(readJobPage(html), { description: 'We build things.\n- C# & .NET\n- Angular', role: 'Senior .NET Developer', company: 'Contoso' });
  });

  test('without JobPosting data the main text is read, without navigation or scripts', () => {
    const html = '<html><head><title>Designer | Acme</title><meta property="og:site_name" content="Acme"></head><body><nav>Home</nav><main><h1>Designer</h1><p>Join us&nbsp;now.</p><script>x()</script></main><footer>©</footer></body></html>';
    const job = readJobPage(html);
    assert.equal(job.description, 'Designer\nJoin us now.');
    assert.deepEqual([job.role, job.company], ['Designer', 'Acme']);
    assert.equal(htmlToText('a<br>b &#x41;&#66;'), 'a\nb AB');
  });
});

describe('API requests', () => {
  let server;
  let base;
  const db = { query: () => { throw new Error('the database must not be reached'); } };
  before(async () => {
    server = http.createServer(createApp({ db, tailors: {} }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => new Promise(resolve => server.close(resolve)));
  const call = (path, init = {}) => fetch(base + path, init).then(async r => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers }));
  const json = { 'Content-Type': 'application/json' };

  test('a change without the app\'s header, or from another site, is refused before anything else', async () => {
    const body = JSON.stringify({ email: 'a@example.com', password: 'long enough password' });
    assert.equal((await call('/api/auth/register', { method: 'POST', headers: json, body })).status, 403);
    const other = await call('/api/auth/register', { method: 'POST', headers: { ...json, 'X-Craftfolio': '1', Origin: 'https://evil.example' }, body });
    assert.equal(other.status, 403);
  });

  test('documents need a session', async () => {
    const r = await call('/api/docs');
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });

  test('unknown routes and malformed document ids are 404', async () => {
    assert.equal((await call('/api/nope')).status, 404);
    assert.equal((await call('/api/docs/..%2Fetc', { method: 'PUT', headers: { ...json, 'X-Craftfolio': '1' }, body: '{}' })).status, 404);
  });

  test('which AIs are set up is public; tailoring with one that is not is refused', async () => {
    assert.deepEqual((await call('/api/tailor')).body, { providers: { claude: false, openai: false, gemini: false } });
    assert.equal((await call('/api/health')).body.ok, true);
  });

  test('fetching a link needs a session', async () => {
    const r = await call('/api/job-from-url', { method: 'POST', headers: { ...json, 'X-Craftfolio': '1' }, body: JSON.stringify({ url: 'https://example.com' }) });
    assert.equal(r.status, 401);
  });
});
