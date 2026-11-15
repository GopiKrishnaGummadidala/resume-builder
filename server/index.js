// Craftfolio API server. Configuration comes from the environment:
//   DATABASE_URL   postgres://user:password@host:5432/craftfolio   (required)
//   PORT           port to listen on (default 3000)
//   COOKIE_SECURE  true | false | auto (default auto: Secure cookies when the request came over HTTPS)
//   TRUST_PROXY    1 when behind nginx: client address and protocol come from X-Forwarded-*
//   STATIC_DIR     also serve the app's files from this folder (development; production uses nginx)
//   ANTHROPIC_API_KEY  turns on tailoring with Claude (optional)
//   TAILOR_MODEL   Claude model for tailoring (default claude-opus-5-5)
//   OPENAI_API_KEY turns on tailoring with ChatGPT (optional)
//   OPENAI_MODEL   OpenAI model for tailoring (default gpt-5.5)
//   Without either key, tailoring still works through the AI websites (copy and paste).
import http from 'node:http';
import { createPool, migrate } from './db.js';
import { createApp } from './app.js';

const env = process.env;
if (!env.DATABASE_URL) {
  console.error('DATABASE_URL is not set, e.g. postgres://craftfolio:secret@localhost:5432/craftfolio');
  process.exit(1);
}
const db = createPool(env.DATABASE_URL);
await migrate(db);

const secureCookies = env.COOKIE_SECURE === 'true' ? true : env.COOKIE_SECURE === 'false' ? false : 'auto';
const tailors = {};
if (env.ANTHROPIC_API_KEY) tailors.claude = (await import('./tailor.js')).createTailor({ model: env.TAILOR_MODEL || 'claude-opus-5-5' });
if (env.OPENAI_API_KEY) tailors.openai = (await import('./tailor-openai.js')).createOpenAITailor({ model: env.OPENAI_MODEL || 'gpt-5.5' });
const app = createApp({ db, secureCookies, trustProxy: env.TRUST_PROXY === '1', staticDir: env.STATIC_DIR || '', tailors });
const port = Number(env.PORT || 3000);
const server = http.createServer(app);
server.listen(port, () => console.log(`Craftfolio API listening on :${port}${env.STATIC_DIR ? ' (also serving the app)' : ''}${Object.keys(tailors).length ? `, tailoring with ${Object.keys(tailors).join(' and ')} on` : ''}`));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => db.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}
