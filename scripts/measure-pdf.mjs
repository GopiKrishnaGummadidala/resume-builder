// Measures PDF size and build time for different encoder settings, using a full one-page letter.
// Usage: node scripts/measure-pdf.mjs [baseUrl]     (needs the app running; default http://localhost:4173)
// The numbers in docs/design-rationale.md and docs/load-test.md come from this script.
import { chromium } from '@playwright/test';
import { FULL_LETTER_BODY } from '../tests/fixtures.js';

const base = process.argv[2] || 'http://localhost:4173';
const variants = [
  { label: 'JPEG q0.95, scale 2 (old default)', encoder: 'jpeg', jpegQuality: 0.95, scale: 2 },
  { label: 'JPEG q0.82, scale 2', encoder: 'jpeg', jpegQuality: 0.82, scale: 2 },
  { label: 'JPEG q0.82, scale 1.5', encoder: 'jpeg', jpegQuality: 0.82, scale: 1.5 },
  { label: 'Indexed PNG 256 colours, scale 2', encoder: 'indexed', colors: 256, scale: 2 },
  { label: 'Indexed PNG 48 colours, scale 2 (default)', encoder: 'indexed', colors: 48, scale: 2 },
  { label: 'Indexed PNG 16 colours, scale 2', encoder: 'indexed', colors: 16, scale: 2 },
  { label: 'Indexed PNG 48 colours, scale 1.5', encoder: 'indexed', colors: 48, scale: 1.5 },
];

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined }); // PW_CHANNEL=msedge uses an installed browser
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(base);
await page.waitForSelector('.hero');

const rows = [];
for (const v of variants) {
  const { label, ...opts } = v;
  const r = await page.evaluate(async ({ body, opts }) => {
    const { blankLetter } = await import('/js/data.js');
    const { buildPdf } = await import('/js/pdf-export.js');
    const l = blankLetter();
    Object.assign(l.personal, { name: 'Jordan Rivera', title: 'Full stack software engineer', email: 'jordan.rivera@example.com', phone: '+49 151 23456789', location: 'Hamburg, Germany', linkedin: 'linkedin.com/in/jordanrivera', github: 'github.com/jrivera' });
    l.recipient.name = 'Mr. Brandt';
    l.greeting = 'Dear Mr. Brandt,';
    l.body = body;
    await buildPdf(l, document.querySelector('#print-area'), opts); // warm-up: loads libraries and fonts
    const t0 = performance.now();
    const { blob, pages } = await buildPdf(l, document.querySelector('#print-area'), opts);
    return { kb: Math.round(blob.size / 1024), ms: Math.round(performance.now() - t0), pages };
  }, { body: FULL_LETTER_BODY, opts });
  rows.push({ setting: label, 'size (KB)': r.kb, 'build (ms)': r.ms, pages: r.pages });
}
await browser.close();
console.table(rows);
