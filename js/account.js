// Accounts. When the app is served together with the Craftfolio API (server/), people can sign in and
// their documents are kept in its database. Served as plain files (no API), the app works as before:
// everything stays in this browser, and nothing about accounts is shown.
const HEADERS = { 'Content-Type': 'application/json', 'X-Craftfolio': '1' };

async function call(method, path, body, { timeout = 15_000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      credentials: 'same-origin',
      headers: HEADERS,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch {
    const err = new Error('Could not reach the server. Check your connection.');
    err.status = 0;
    throw err;
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty or not JSON */ }
  if (!res.ok) {
    const err = new Error(data?.error || `The server answered ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  /** {available: false} when there is no API (static hosting); else {available: true, user}. */
  async session() {
    try {
      const data = await call('GET', 'auth/me', undefined, { timeout: 4000 });
      return { available: true, user: data?.user || null };
    } catch (err) {
      // 404 or no answer: the files are served without the API. Any other error: the API exists but failed.
      return { available: err.status !== 404 && err.status !== 0, user: null };
    }
  },
  register: (email, password) => call('POST', 'auth/register', { email, password }).then(d => d.user),
  login: (email, password) => call('POST', 'auth/login', { email, password }).then(d => d.user),
  logout: () => call('POST', 'auth/logout'),
  docs: () => call('GET', 'docs'),
  putDoc: doc => call('PUT', `docs/${encodeURIComponent(doc.id)}`, { doc }),
  deleteDoc: (id, at) => call('DELETE', `docs/${encodeURIComponent(id)}?at=${encodeURIComponent(at)}`),
  /** Which AIs the server can tailor with (it has their API keys): {claude, openai, gemini}. */
  tailorStatus: () => call('GET', 'tailor', undefined, { timeout: 4000 }).then(d => ({ claude: !!d?.providers?.claude, openai: !!d?.providers?.openai, gemini: !!d?.providers?.gemini })),
  /** A tailoring plan from one of the server's AIs ('claude', 'openai' or 'gemini'); can take a minute or two. */
  tailor: (doc, job, provider) => call('POST', 'tailor', { doc, job, provider }, { timeout: 200_000 }).then(d => d.plan),
  /** The job ad on a web page, read by the server: {description, role, company, source, url}. */
  fetchJob: url => call('POST', 'job-from-url', { url }, { timeout: 30_000 }).then(d => d.job),
};

/**
 * Keeps the signed-in user's documents in step with the server. The browser keeps a working copy, so
 * the app stays fast and keeps working offline; edits are sent after a short pause, and changes made on
 * other devices are fetched when the app regains focus and every minute.
 * @param {ReturnType<import('./store.js').createStore>} store
 * @param {(status: 'saving'|'saved'|'offline'|'signed-out') => void} onStatus
 */
export function createSync(store, onStatus = () => {}) {
  const server = new Map(); // id -> updatedAt the server is known to have
  const serverDeleted = new Map(); // id -> deletion time the server is known to have
  let timer = null;
  let running = null;
  let again = false;
  let stopped = false;
  let poll = null;

  async function pull() {
    const remote = await api.docs();
    for (const d of remote.docs) server.set(d.id, d.updatedAt);
    for (const [id, at] of Object.entries(remote.deleted || {})) { serverDeleted.set(id, at); server.delete(id); }
    store.mergeRemote(remote);
  }

  async function push() {
    let stale = false;
    for (const d of [...store.docs]) {
      if (server.get(d.id) === d.updatedAt) continue;
      const at = d.updatedAt;
      const { saved } = await api.putDoc(d);
      server.set(d.id, at);
      if (!saved) stale = true; // the server has a newer copy (another device): fetch it
    }
    for (const [id, at] of Object.entries(store.deleted)) {
      if (serverDeleted.get(id) === at) continue;
      await api.deleteDoc(id, at);
      serverDeleted.set(id, at);
      server.delete(id);
    }
    if (stale) await pull();
  }

  function run(withPull) {
    if (stopped) return Promise.resolve();
    if (running) { again = true; return running; }
    onStatus('saving');
    running = (async () => {
      try {
        if (withPull) await pull();
        await push();
        onStatus('saved');
      } catch (err) {
        onStatus(err.status === 401 ? 'signed-out' : 'offline');
      } finally {
        running = null;
        if (again && !stopped) { again = false; schedule(); }
      }
    })();
    return running;
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(() => run(false), 800); }
  const onFocus = () => { if (document.visibilityState === 'visible') run(true); };

  const unsubscribe = store.onSaved(schedule);
  return {
    /** Fetch the account's documents, merge them with this browser's copy and send what the server lacks. */
    start() {
      document.addEventListener('visibilitychange', onFocus);
      window.addEventListener('online', onFocus);
      poll = setInterval(() => { if (document.visibilityState === 'visible') run(true); }, 60_000);
      return run(true);
    },
    /** Send pending edits now (before signing out). */
    async flush() {
      clearTimeout(timer);
      if (running) await running;
      await run(false);
      clearTimeout(timer);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(poll);
      unsubscribe();
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('online', onFocus);
    },
  };
}
