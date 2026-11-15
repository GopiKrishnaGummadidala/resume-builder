// Passwords, session tokens and rate limits.
import { scrypt, randomBytes, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
// scrypt with N = 2^15 (about 32 MB and tens of milliseconds per hash): slow to brute-force, fine for sign-ins.
const COST = { N: 32768, r: 8, p: 1 };
const KEY_LENGTH = 32;
const maxmem = c => 256 * c.N * c.r; // scrypt needs 128 * N * r bytes; leave headroom

/** "scrypt$N$r$p$salt$key", salt and key in base64url. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password.normalize('NFKC'), salt, KEY_LENGTH, { ...COST, maxmem: maxmem(COST) });
  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

/** True when `password` matches `stored`. Takes the same time whether or not it matches. */
export async function verifyPassword(password, stored) {
  const [kind, N, r, p, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt' || !salt || !key) return false;
  const cost = { N: Number(N), r: Number(r), p: Number(p) };
  if (![cost.N, cost.r, cost.p].every(Number.isSafeInteger)) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await scryptAsync(String(password).normalize('NFKC'), Buffer.from(salt, 'base64url'), expected.length, { ...cost, maxmem: maxmem(cost) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A new session token for the cookie (256 random bits). */
export const newToken = () => randomBytes(32).toString('base64url');
/** What is stored for a token: its SHA-256, so a database leak does not leak usable sessions. */
export const tokenHash = token => createHash('sha256').update(String(token)).digest();

/**
 * Fixed-window counter per key ("ip" or "ip|email"). In memory: fine for one server process.
 * @returns {(key: string) => boolean} true while the key is under `max` hits in the current window
 */
export function rateLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map();
  return key => {
    const t = now();
    if (hits.size > 10_000) for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k);
    const entry = hits.get(key);
    if (!entry || t - entry.start > windowMs) { hits.set(key, { start: t, count: 1 }); return true; }
    entry.count += 1;
    return entry.count <= max;
  };
}
