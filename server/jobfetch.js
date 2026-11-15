// Fetch a job ad from a link and read its text. The server fetches on behalf of a signed-in user, so
// the fetch must not become a way into the server's own network (SSRF):
//   - only http(s) on the standard ports, no user:password@ in the link
//   - every address is checked at the moment of connecting (also after each redirect), and private,
//     loopback, link-local and other non-public addresses are refused
//   - at most 5 redirects, 10 s, 3 MB
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import zlib from 'node:zlib';

const MAX_BYTES = 3_000_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 5;
const UA = 'Mozilla/5.0 (compatible; CraftfolioJobReader/1.0; reads one job ad for its user)';

export class FetchError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

/** True for addresses on the public internet; false for private, loopback, link-local, reserved… */
export function isPublicAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false; // this-net, private, loopback, multicast/reserved
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && ip.startsWith('192.0.0.')) || (b === 0 && ip.startsWith('192.0.2.')))) return false;
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51 && ip.startsWith('198.51.100.')) return false;
    if (a === 203 && ip.startsWith('203.0.113.')) return false;
    return true;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return false;
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    if (/^(fc|fd)/.test(v)) return false; // unique local
    if (/^fe[89ab]/.test(v)) return false; // link-local
    if (/^ff/.test(v)) return false; // multicast
    if (v.startsWith('2001:db8') || v.startsWith('64:ff9b') || v.startsWith('100::')) return false;
    return true;
  }
  return false;
}

/** DNS lookup that refuses non-public addresses: used for the connection itself (no rebinding gap). */
function guardedLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const list = Array.isArray(addresses) ? addresses : [{ address: addresses, family: options.family || 4 }];
    const bad = list.find(a => !isPublicAddress(a.address));
    if (bad || !list.length) return callback(new FetchError(400, 'That link points to a private or local address, which cannot be fetched.'));
    if (options.all) return callback(null, list);
    return callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw) {
  let url;
  try { url = new URL(String(raw).trim()); } catch { throw new FetchError(400, 'That is not a valid link.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new FetchError(400, 'Only http and https links can be fetched.');
  if (url.username || url.password) throw new FetchError(400, 'Links with a user name or password cannot be fetched.');
  if (url.port && !['80', '443'].includes(url.port)) throw new FetchError(400, 'Only links on the standard web ports can be fetched.');
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, '')) && !isPublicAddress(url.hostname.replace(/^\[|\]$/g, ''))) {
    throw new FetchError(400, 'That link points to a private or local address, which cannot be fetched.');
  }
  url.hash = '';
  return url;
}

function getOnce(url) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: guardedLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'gzip, deflate, br', 'Accept-Language': 'en,de;q=0.8' },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        resolve({ redirect: new URL(res.headers.location, url) });
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new FetchError(422, res.statusCode === 403 || res.statusCode === 401 || res.statusCode === 999
          ? 'That site does not let other programs read its job ads (it needs a login or blocks robots). Open it and paste the text instead.'
          : `The site answered ${res.statusCode}. Check the link, or paste the job text instead.`));
        return;
      }
      const type = String(res.headers['content-type'] || '');
      if (type && !/text\/html|application\/xhtml|text\/plain|application\/ld\+json|application\/json/.test(type)) {
        res.resume();
        reject(new FetchError(422, 'That link is not a web page. Paste the job text instead.'));
        return;
      }
      const enc = String(res.headers['content-encoding'] || '');
      const stream = enc.includes('br') ? res.pipe(zlib.createBrotliDecompress())
        : enc.includes('gzip') ? res.pipe(zlib.createGunzip())
          : enc.includes('deflate') ? res.pipe(zlib.createInflate()) : res;
      const chunks = [];
      let size = 0;
      stream.on('data', c => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(); reject(new FetchError(422, 'That page is too large to read.')); return; }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), url }));
      stream.on('error', () => reject(new FetchError(422, 'The page could not be read.')));
    });
    req.on('timeout', () => req.destroy(new FetchError(504, 'The site took too long to answer.')));
    req.on('error', err => reject(err instanceof FetchError ? err : new FetchError(422, 'The site could not be reached. Check the link, or paste the job text instead.')));
  });
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·' };
const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') {
    const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
  }
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Readable text from HTML: block elements become line breaks, list items get a dash. */
export function htmlToText(html) {
  return decode(String(html)
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/ul|\/ol|\/section|\/article|\/tr)[^>]*>/gi, '\n')
    .replace(/<\/?(b|strong|i|em|u|span|a|small|mark|code|sup|sub)\b[^>]*>/gi, '') // inline: no extra space
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n+- /g, '\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** The JobPosting in the page's JSON-LD, if any (most job boards publish one for search engines). */
function jobPosting(html) {
  const blocks = String(html).match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    let data;
    try { data = JSON.parse(decode(block.replace(/^<script[^>]*>|<\/script>$/gi, '').trim())); } catch { continue; }
    const items = [data].flat().flatMap(d => (d && d['@graph'] ? d['@graph'] : [d]));
    const job = items.find(d => d && [d['@type']].flat().includes('JobPosting'));
    if (job) return job;
  }
  return null;
}

const meta = (html, name) => {
  const m = String(html).match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']*)["']`, 'i'))
    || String(html).match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${name}["']`, 'i'));
  return m ? decode(m[1]).trim() : '';
};

/** Job text, title and company from a page's HTML. */
export function readJobPage(html) {
  const job = jobPosting(html);
  if (job?.description) {
    const org = job.hiringOrganization;
    return {
      description: htmlToText(job.description),
      role: String(job.title || '').trim(),
      company: String((typeof org === 'string' ? org : org?.name) || '').trim(),
    };
  }
  const body = (String(html).match(/<main[\s\S]*?<\/main>/i) || String(html).match(/<article[\s\S]*?<\/article>/i) || String(html).match(/<body[\s\S]*<\/body>/i) || [String(html)])[0]
    .replace(/<(nav|header|footer|aside|form)[\s\S]*?<\/\1>/gi, ' ');
  const title = meta(html, 'og:title') || decode((String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  return { description: htmlToText(body), role: title.split(/\s[|–-]\s/)[0].trim(), company: meta(html, 'og:site_name') };
}

/** Fetch `link` and read the job ad on it. */
export async function fetchJob(link, maxChars) {
  let url = checkUrl(link);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await getOnce(url);
    if (res.redirect) { url = checkUrl(res.redirect.href); continue; }
    const job = readJobPage(res.html);
    if (job.description.length < 200) {
      throw new FetchError(422, 'No job text could be read on that page (it may need a login or load its content with JavaScript). Open it and paste the text instead.');
    }
    return { ...job, description: job.description.slice(0, maxChars), source: url.hostname.replace(/^www\./, ''), url: url.href };
  }
  throw new FetchError(422, 'That link redirects too many times.');
}
