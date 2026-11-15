// The Craftfolio API: accounts, sessions and each user's documents, as one request handler.
//
//   POST   /api/auth/register  {email, password}   create an account and sign in
//   POST   /api/auth/login     {email, password}   sign in
//   POST   /api/auth/logout                        sign out (this browser)
//   GET    /api/auth/me                            {user} or {user: null}
//   GET    /api/docs                               {docs, deleted}: every document of the user
//   PUT    /api/docs/:id       {doc}               save a document (the newer copy wins)
//   DELETE /api/docs/:id?at=ms                     delete a document (kept as a tombstone)
//   GET    /api/tailor                             {providers: {claude, openai}}: which AIs are set up
//   POST   /api/tailor         {doc, job, provider} a tailoring plan from that AI (signed-in users)
//   POST   /api/job-from-url   {url}               the job ad on a page: {description, role, company, source}
//
// Requests that change anything must send "X-Craftfolio: 1" and come from this site (Origin), so
// another site cannot make a signed-in browser act (CSRF). The session cookie is HttpOnly and SameSite.
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeDoc } from '../js/data.js';
import { hashPassword, verifyPassword, newToken, tokenHash, rateLimiter } from './security.js';
import { JOB_MAX_CHARS } from '../js/tailor.js';
import { fetchJob } from './jobfetch.js';

const COOKIE = 'cf_sid';
const SESSION_DAYS = 30;
const BODY_LIMIT = 1_000_000; // a document with a photo is well under this
const MAX_DOCS = 500; // per user
const TOMBSTONE_DAYS = 90;
const DOC_ID = /^[a-z0-9]{4,16}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PASSWORD_MIN = 10;
const PASSWORD_MAX = 200;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const API_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...API_HEADERS, ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > BODY_LIMIT) { reject(new HttpError(413, 'That is too large to save')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new HttpError(400, 'The request is not valid JSON')); }
    });
    req.on('error', reject);
  });
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

/**
 * @param {object} o
 * @param {import('pg').Pool} o.db
 * @param {true|false|'auto'} [o.secureCookies] 'auto': Secure when the request came over HTTPS
 * @param {boolean} [o.trustProxy] take the client address and protocol from X-Forwarded-* (behind nginx)
 * @param {string} [o.staticDir] also serve the app's files from here (development)
 * @param {Record<string, (doc: object, job: object) => Promise<object>>} [o.tailors] tailoring per AI that is set up:
 *   claude (server/tailor.js), openai (server/tailor-openai.js)
 */
export function createApp({ db, secureCookies = 'auto', trustProxy = false, staticDir = '', tailors = {} }) {
  const loginByIp = rateLimiter({ max: 50, windowMs: 15 * 60_000 });
  const loginByAccount = rateLimiter({ max: 10, windowMs: 15 * 60_000 });
  const registerByIp = rateLimiter({ max: 20, windowMs: 60 * 60_000 });
  const tailorByUser = rateLimiter({ max: 20, windowMs: 60 * 60_000 }); // each call costs money
  const fetchByUser = rateLimiter({ max: 30, windowMs: 60 * 60_000 });
  // Compared against when an address has no account, so a wrong address takes as long as a wrong password.
  const dummyHash = hashPassword('not a real password');

  const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
  const isHttps = req => req.socket.encrypted || (trustProxy && req.headers['x-forwarded-proto'] === 'https');

  function sessionCookie(req, token, maxAge) {
    const secure = secureCookies === true || (secureCookies === 'auto' && isHttps(req));
    return `${COOKIE}=${token}; Path=/api; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }

  async function startSession(req, userId) {
    const token = newToken();
    await db.query("DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()", [userId]);
    await db.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [tokenHash(token), userId]);
    return sessionCookie(req, token, SESSION_DAYS * 86400);
  }

  async function currentUser(req) {
    const token = cookies(req)[COOKIE];
    if (!token) return null;
    const { rows } = await db.query(
      'SELECT u.id, u.email FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()',
      [tokenHash(token)],
    );
    return rows[0] || null;
  }
  async function requireUser(req) {
    const user = await currentUser(req);
    if (!user) throw new HttpError(401, 'Please sign in again');
    return user;
  }

  /** Writes must come from this site: our own header (which forces a CORS preflight) and a matching Origin. */
  function checkSameSite(req) {
    if (req.headers['x-craftfolio'] !== '1') throw new HttpError(403, 'Request refused');
    const origin = req.headers.origin;
    if (origin) {
      const host = (trustProxy && req.headers['x-forwarded-host']) || req.headers.host;
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* malformed */ }
      if (originHost !== host) throw new HttpError(403, 'Request refused');
    }
  }

  function credentials(body) {
    const email = String(body?.email ?? '').trim();
    const password = String(body?.password ?? '');
    if (email.length > 254 || !EMAIL.test(email)) throw new HttpError(400, 'Enter a valid email address');
    if (password.length > PASSWORD_MAX) throw new HttpError(400, `Use at most ${PASSWORD_MAX} characters for the password`);
    return { email, password };
  }

  const routes = {
    'POST /api/auth/register': async req => {
      if (!registerByIp(clientIp(req))) throw new HttpError(429, 'Too many new accounts from here. Try again later.');
      const { email, password } = credentials(await readJson(req));
      if (password.length < PASSWORD_MIN) throw new HttpError(400, `Use at least ${PASSWORD_MIN} characters for the password`);
      const hash = await hashPassword(password);
      let user;
      try {
        ({ rows: [user] } = await db.query('INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email', [email, hash]));
      } catch (err) {
        if (err.code === '23505') throw new HttpError(409, 'An account with this email already exists. Sign in instead.');
        throw err;
      }
      return [201, { user }, { 'Set-Cookie': await startSession(req, user.id) }];
    },

    'POST /api/auth/login': async req => {
      const { email, password } = credentials(await readJson(req));
      const ip = clientIp(req);
      if (!loginByIp(ip) || !loginByAccount(`${ip}|${email.toLowerCase()}`)) throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
      const { rows: [row] } = await db.query('SELECT id, email, password_hash FROM users WHERE lower(email) = lower($1)', [email]);
      const ok = await verifyPassword(password, row ? row.password_hash : await dummyHash);
      if (!row || !ok) throw new HttpError(401, 'Wrong email or password');
      return [200, { user: { id: row.id, email: row.email } }, { 'Set-Cookie': await startSession(req, row.id) }];
    },

    'POST /api/auth/logout': async req => {
      const token = cookies(req)[COOKIE];
      if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash(token)]);
      return [200, { user: null }, { 'Set-Cookie': sessionCookie(req, '', 0) }];
    },

    'GET /api/auth/me': async req => [200, { user: await currentUser(req) }],

    'GET /api/docs': async req => {
      const user = await requireUser(req);
      const cutoff = Date.now() - TOMBSTONE_DAYS * 86400_000;
      await db.query('DELETE FROM documents WHERE user_id = $1 AND data IS NULL AND deleted_at < $2', [user.id, cutoff]);
      const { rows } = await db.query('SELECT id, data, deleted_at FROM documents WHERE user_id = $1 ORDER BY updated_at DESC', [user.id]);
      const docs = rows.filter(r => r.data).map(r => r.data);
      const deleted = Object.fromEntries(rows.filter(r => !r.data && r.deleted_at).map(r => [r.id, Number(r.deleted_at)]));
      return [200, { docs, deleted }];
    },

    'PUT /api/docs/:id': async (req, id) => {
      const user = await requireUser(req);
      const doc = normalizeDoc((await readJson(req)).doc);
      if (!doc || doc.id !== id) throw new HttpError(400, 'That is not a Craftfolio document');
      const { rows: [{ count }] } = await db.query('SELECT count(*)::int AS count FROM documents WHERE user_id = $1 AND data IS NOT NULL AND id <> $2', [user.id, id]);
      if (count >= MAX_DOCS) throw new HttpError(403, `An account can hold up to ${MAX_DOCS} documents`);
      // The newer copy wins, as in the browser; a deletion newer than this edit wins too.
      const { rowCount } = await db.query(
        `INSERT INTO documents (user_id, id, data, updated_at) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, id) DO UPDATE SET data = EXCLUDED.data, updated_at = EXCLUDED.updated_at, deleted_at = NULL
         WHERE documents.updated_at <= EXCLUDED.updated_at AND (documents.deleted_at IS NULL OR documents.deleted_at < EXCLUDED.updated_at)`,
        [user.id, id, doc, doc.updatedAt],
      );
      return [200, { saved: rowCount === 1 }];
    },

    'GET /api/tailor': async () => [200, { providers: { claude: !!tailors.claude, openai: !!tailors.openai } }],

    'POST /api/tailor': async req => {
      const user = await requireUser(req);
      const body = await readJson(req);
      const tailor = tailors[body.provider];
      if (!tailor) throw new HttpError(404, 'That AI is not set up on this server. Pick another one.');
      if (!tailorByUser(user.id)) throw new HttpError(429, 'You have tailored a lot this hour. Try again later.');
      const doc = normalizeDoc(body.doc);
      if (!doc || doc.type !== 'resume') throw new HttpError(400, 'That is not a CV');
      const description = String(body.job?.description ?? '').trim();
      if (description.length < 80) throw new HttpError(400, 'Paste the full job description (at least a few sentences)');
      if (description.length > JOB_MAX_CHARS) throw new HttpError(400, `Keep the job description under ${JOB_MAX_CHARS.toLocaleString('en')} characters`);
      const job = {
        description,
        company: String(body.job?.company ?? '').slice(0, 120),
        role: String(body.job?.role ?? '').slice(0, 120),
        letterLanguage: body.job?.letterLanguage === 'job' ? 'job' : 'cv',
      };
      try {
        return [200, { plan: await tailor(doc, job) }];
      } catch (err) {
        if (err.status) throw new HttpError(err.status, err.message);
        throw err;
      }
    },

    // Signed-in users only, so the server is not an open fetcher for anyone on the internet.
    'POST /api/job-from-url': async req => {
      const user = await requireUser(req);
      if (!fetchByUser(user.id)) throw new HttpError(429, 'You have fetched a lot of links this hour. Try again later.');
      const { url } = await readJson(req);
      if (typeof url !== 'string' || url.length > 2000) throw new HttpError(400, 'That is not a valid link.');
      try {
        return [200, { job: await fetchJob(url, JOB_MAX_CHARS) }];
      } catch (err) {
        if (err.status) throw new HttpError(err.status, err.message);
        throw err;
      }
    },

    'DELETE /api/docs/:id': async (req, id, url) => {
      const user = await requireUser(req);
      const at = Number(url.searchParams.get('at'));
      const when = Number.isFinite(at) && at > 0 && at <= Date.now() + 86400_000 ? Math.round(at) : Date.now();
      // An edit made after the deletion wins (the document stays), as in the browser.
      await db.query(
        `INSERT INTO documents (user_id, id, data, updated_at, deleted_at) VALUES ($1, $2, NULL, $3, $3)
         ON CONFLICT (user_id, id) DO UPDATE SET data = NULL, deleted_at = EXCLUDED.deleted_at
         WHERE documents.updated_at <= EXCLUDED.deleted_at`,
        [user.id, id, when],
      );
      return [204];
    },
  };

  async function api(req, res, url) {
    const parts = url.pathname.split('/');
    let key = `${req.method} ${url.pathname}`;
    let id = '';
    if (parts.length === 4 && parts[2] === 'docs' && parts[3]) {
      id = parts[3];
      if (!DOC_ID.test(id)) throw new HttpError(404, 'Not found');
      key = `${req.method} /api/docs/:id`;
    }
    const handler = routes[key];
    if (!handler) throw new HttpError(404, 'Not found');
    if (req.method !== 'GET') checkSameSite(req);
    const [status, body, headers] = await handler(req, id, url);
    send(res, status, body, headers);
  }

  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/health') return send(res, 200, { ok: true });
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (staticDir) return await serveStatic(staticDir, url.pathname, res);
      throw new HttpError(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      console.error(err);
      return send(res, 500, { error: 'Something went wrong on the server. Try again.' });
    }
  };
}

// Development only: the app's own files, as scripts/serve.mjs serves them. Production serves them with nginx.
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf',
};
const PUBLIC = [/^\/index\.html$/, /^\/artifact\.html$/, /^\/css\/[\w.-]+\.css$/, /^\/js\/[\w.-]+\.js$/, /^\/fonts\/[\w-]+\/[\w.-]+\.ttf$/];
async function serveStatic(root, pathname, res) {
  const file = pathname === '/' ? '/index.html' : decodeURIComponent(pathname);
  if (!PUBLIC.some(re => re.test(file))) throw new HttpError(404, 'Not found');
  let body;
  try { body = await fs.readFile(path.join(root, file)); } catch { throw new HttpError(404, 'Not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(body);
}
