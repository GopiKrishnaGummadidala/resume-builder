// Import an existing CV: PDF (via pdf.js, loaded on demand) or plain text.
//
// A PDF is read in two steps:
//   1. Layout (itemsToText): the positioned text runs of each page become lines of text in reading
//      order. Two-column pages are split at the gutter so the main column is read first and the side
//      column after it; bold runs are kept as **bold**, wide gaps inside a line as a tab, and a larger
//      gap between lines as a blank line.
//   2. Parsing (parseResumeText): the text is cut into sections at their headings and each section
//      is turned into structured fields. It is best-effort: the result is meant to be reviewed.
// Both steps are pure functions, tested without a browser. Only fileToText touches pdf.js.
import { blankResume, uid, languageLevel } from './data.js';
import { loadLib, libUrl } from './platform.js';
import { squarePhoto } from './photo.js';

// The worker script is loaded in-page (it defines window.pdfjsWorker) so pdf.js runs on the main
// thread; cross-origin Web Workers are blocked in sandboxed hosts.
async function loadPdfJs() {
  await loadLib('pdfjsWorker');
  const pdfjs = await loadLib('pdfjs');
  pdfjs.GlobalWorkerOptions.workerSrc = libUrl('pdfjsWorker');
  return pdfjs;
}

/**
 * Positioned text runs of every page: [{ width, items: [{ str, x, y, w, h, bold }] }].
 * With 'photo', the array also carries 'photo': the profile picture found on page 1, or ''.
 */
async function pdfPages(file, { photo = false } = {}) {
  const pdfjs = await loadPdfJs();
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  const pages = [];
  if (photo) pages.photo = await findPhoto(pdfjs, await pdf.getPage(1));
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Font names (for bold) are only known once the page's drawing commands have been read.
    const bold = new Map();
    try {
      await page.getOperatorList();
      for (const f of Object.keys(content.styles)) bold.set(f, /bold|black|heavy|semibold|demi/i.test(page.commonObjs.get(f)?.name || ''));
    } catch { /* no font information: nothing is marked bold */ }
    pages.push({
      width: page.getViewport({ scale: 1 }).width,
      items: content.items.map(it => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height, bold: bold.get(it.fontName) === true })),
    });
  }
  return pages;
}

/**
 * The profile picture on a page: the largest roughly square image of at least 80 px, drawn in the top
 * half of the page and narrower than 40% of it. (A PDF made of one page-sized picture, like this app's
 * own export, has no separate photo to take.) Returns a stored-photo data URL, or '' when there is none.
 */
async function findPhoto(pdfjs, page) {
  try {
    const ops = await page.getOperatorList();
    const { width, height } = page.getViewport({ scale: 1 });
    // Follow the transformation matrix to know where each image is drawn.
    const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
    let ctm = [1, 0, 0, 1, 0, 0];
    const stack = [], found = [];
    ops.fnArray.forEach((fn, i) => {
      if (fn === pdfjs.OPS.save) stack.push(ctm);
      else if (fn === pdfjs.OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === pdfjs.OPS.transform) ctm = mul(ctm, ops.argsArray[i]);
      else if (fn === pdfjs.OPS.paintImageXObject) {
        found.push({ name: ops.argsArray[i][0], top: ctm[5] + Math.abs(ctm[3]), drawnWidth: Math.hypot(ctm[0], ctm[1]) });
      }
    });
    let best = null;
    for (const f of found.filter(f => f.top > height / 2 && f.drawnWidth < width * 0.4)) {
      const img = await new Promise(resolve => {
        const get = objs => { try { objs.get(f.name, resolve); return true; } catch { return false; } };
        if (!get(page.objs) && !get(page.commonObjs)) resolve(null);
      });
      if (!img?.width || img.width < 80 || img.height < 80) continue;
      const ratio = img.width / img.height;
      if (ratio < 0.7 || ratio > 1.4) continue;
      if (!best || img.width * img.height > best.width * best.height) best = img;
    }
    return best ? squarePhoto(imageSource(best), best.width, best.height) : '';
  } catch {
    return ''; // a picture that cannot be read is simply not imported
  }
}

/** Something drawable for a pdf.js image: its bitmap, or its pixels painted on a canvas. */
function imageSource(img) {
  if (img.bitmap) return img.bitmap;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  const out = ctx.createImageData(img.width, img.height);
  const src = img.data;
  const n = img.width * img.height;
  const per = src.length / n; // 4 = RGBA, 3 = RGB, 1 = grey
  for (let p = 0; p < n; p++) {
    const s = p * per, d = p * 4;
    out.data[d] = src[s];
    out.data[d + 1] = per >= 3 ? src[s + 1] : src[s];
    out.data[d + 2] = per >= 3 ? src[s + 2] : src[s];
    out.data[d + 3] = per === 4 ? src[s + 3] : 255;
  }
  ctx.putImageData(out, 0, 0);
  return canvas;
}

/** Read a CV file (PDF or text) into a new CV, including the photo of a PDF. */
export async function importCv(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pages = await pdfPages(file, { photo: true });
    const doc = parseResumeText(itemsToText(pages));
    doc.personal.photo = pages.photo || '';
    return doc;
  }
  return parseResumeText(await file.text());
}

export async function fileToText(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return itemsToText(await pdfPages(file));
  return file.text();
}

// ---------- layout: positioned runs -> text ----------

const ROW_TOLERANCE = 2.5;   // runs whose baselines differ by less are on the same line (points)
const MIN_GUTTER = 8;        // narrowest empty band that counts as a column gutter (points)
const MIN_COLUMN_ROWS = 4;   // a column needs at least this many lines

/** Group runs into lines, top to bottom; each line's runs are ordered left to right. */
function toRows(items) {
  const rows = [];
  [...items].sort((a, b) => b.y - a.y || a.x - b.x).forEach(it => {
    const row = rows[rows.length - 1];
    if (row && Math.abs(row.y - it.y) <= ROW_TOLERANCE) row.items.push(it);
    else rows.push({ y: it.y, items: [it] });
  });
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}

/**
 * Find the empty vertical band between two columns, or null for a one-column page.
 *
 * Every band that almost no line crosses is a candidate. A candidate is a real gutter only when both
 * sides have lines of their own: if most lines on the right share a baseline with a line on the left,
 * the right side is right-aligned dates or places inside one column, not a column. A narrow left side
 * made mostly of section titles is a side-heading layout, also read as one column. Of the real
 * gutters, the one with the most lines of its own on the right wins.
 */
function findGutter(rows, width) {
  if (rows.length < MIN_COLUMN_ROWS * 2) return null;
  const covered = new Array(Math.ceil(width) + 2).fill(0);
  rows.forEach(r => {
    const bins = new Set();
    r.items.forEach(it => { for (let x = Math.max(0, Math.floor(it.x)); x <= Math.min(width, Math.ceil(it.x + it.w)); x++) bins.add(x); });
    bins.forEach(x => covered[x]++);
  });
  const allowed = Math.max(1, Math.floor(rows.length * 0.15)); // a few lines may cross (a wide heading)
  const bands = [];
  for (let x = Math.floor(width * 0.2), start = null; x <= Math.ceil(width * 0.8) + 1; x++) {
    const empty = x <= width * 0.8 && covered[x] <= allowed;
    if (empty && start === null) start = x;
    if (!empty && start !== null) {
      if (x - start >= MIN_GUTTER) bands.push({ from: start, to: x });
      start = null;
    }
  }
  const valid = [];
  for (const band of bands) {
    // Sides are judged from the middle of the band: the scan may start inside it, so its left edge can be early.
    const mid = (band.from + band.to) / 2;
    const left = rows.filter(r => r.items.some(it => it.x + it.w <= mid));
    const right = rows.filter(r => r.items.some(it => it.x >= mid));
    if (left.length < MIN_COLUMN_ROWS || right.length < MIN_COLUMN_ROWS) continue;
    const own = right.filter(r => !r.items.some(it => it.x + it.w <= mid)).length;
    if (own < right.length * 0.3) continue;
    const leftText = left.map(r => r.items.filter(it => it.x + it.w <= mid).map(it => it.str).join(' '));
    if (leftText.filter(isHeading).length >= leftText.length * 0.5) continue;
    valid.push({ ...band, mid, own });
  }
  // Two candidates close together are the right edge of the main column's dates and the real gutter
  // just after it (dates set in a slightly smaller font sit on their own baselines, so they can pass
  // the test above). Keep the right-hand one of such a pair.
  const kept = valid.filter((b, i) => !(valid[i + 1] && valid[i + 1].from - b.to < width * 0.15));
  const best = kept.reduce((a, b) => (!a || b.own > a.own ? b : a), null);
  return best && { from: best.from, to: best.to, mid: best.mid };
}

/** One line of text from its runs: bold runs in **, a tab where there is a wide gap. */
function rowText(row) {
  const parts = [];
  let spaced = false; // a run of only spaces came before this one: the words are apart however close they sit
  row.items.forEach(it => {
    if (!it.str.trim()) { spaced = true; return; }
    const prev = parts[parts.length - 1];
    const gap = prev ? it.x - prev.end : 0;
    const apart = (spaced || gap > it.h * 0.15) && !/\s$/.test(prev?.text ?? '') && !/^\s/.test(it.str);
    spaced = false;
    const sep = !prev ? '' : gap > it.h * 0.9 ? '\t' : apart ? ' ' : '';
    if (prev && prev.bold === it.bold && sep !== '\t') { prev.text += sep + it.str; prev.end = it.x + it.w; return; }
    if (prev) prev.after = sep;
    parts.push({ text: it.str, bold: it.bold, end: it.x + it.w, after: '' });
  });
  return parts.map(p => {
    const t = p.text.trim();
    const lead = /^\s/.test(p.text) ? ' ' : '', trail = /\s$/.test(p.text) ? ' ' : '';
    return `${lead}${p.bold && /[\p{L}\p{N}]/u.test(t) ? `**${t}**` : t}${trail}${p.after}`;
  }).join('').replace(/ {2,}/g, ' ').trim();
}

/** Lines of text for one column; a blank line marks a gap larger than the column's usual line spacing. */
function rowsToLines(rows) {
  const gaps = rows.slice(1).map((r, i) => Math.round((rows[i].y - r.y) * 2) / 2).filter(g => g > 0 && g < 40);
  const count = new Map();
  gaps.forEach(g => count.set(g, (count.get(g) || 0) + 1));
  const usual = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? 0;
  const lines = [];
  rows.forEach((r, i) => {
    const text = rowText(r);
    if (!text) return;
    if (i && usual && rows[i - 1].y - r.y >= usual + 0.4 && lines.length && lines[lines.length - 1] !== '') lines.push('');
    lines.push(text);
  });
  return lines;
}

/**
 * Text of a document from its positioned runs, in reading order.
 * @param {{width: number, items: {str: string, x: number, y: number, w: number, h: number, bold?: boolean}[]}[]} pages
 */
export function itemsToText(pages) {
  const main = [], side = [];
  pages.forEach(page => {
    // Runs of only spaces carry no text but mark a word break (rowText), so they are kept; they are
    // given no width, so they never cover a column gutter.
    const items = page.items.filter(it => it.str).map(it => (it.str.trim() ? it : { ...it, w: 0 }));
    const rows = toRows(items);
    // Everything above the first section heading is the page header (name, summary, contact row). It
    // is read as one block even where it sits on both sides of the page, and columns are judged only
    // below it: a header with contact details on the right is not a second column.
    const headingRow = rows.find(r => r.items.some(it => isHeading(it.str)));
    const below = headingRow ? headingRow.y + ROW_TOLERANCE * 2 : Infinity;
    const gutter = findGutter(headingRow ? rows.filter(r => r.y < below) : rows, page.width);
    if (!gutter) { main.push(...rowsToLines(rows), ''); return; }
    // Without a heading, the header ends at the last line that runs across the gutter.
    const crossing = rows.filter(r => r.items.some(it => it.x < gutter.from - 1 && it.x + it.w > gutter.to + 1));
    const headerBottom = headingRow ? below : crossing.length ? Math.min(...crossing.map(r => r.y)) : Infinity;
    const header = items.filter(it => it.y >= headerBottom - ROW_TOLERANCE);
    const body = items.filter(it => it.y < headerBottom - ROW_TOLERANCE);
    main.push(...rowsToLines(toRows(header)), '', ...rowsToLines(toRows(body.filter(it => it.x + it.w / 2 < gutter.mid))), '');
    side.push(...rowsToLines(toRows(body.filter(it => it.x + it.w / 2 >= gutter.mid))), '');
  });
  return [...main, ...side]
    .filter(l => !/^(\*\*)?page \d+( of \d+)?(\*\*)?$/i.test(l)) // page footers
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------- parsing: text -> CV ----------

const HEADINGS = [
  ['summary', /^(professional\s+)?(summary|profile|about( me)?|objective|career objective)$/i],
  ['experience', /^(work\s+|professional\s+)?(experience|employment( history)?|work history|career history)$/i],
  ['education', /^(education|academic background|qualifications)$/i],
  ['skills', /^((technical|core|key)\s+)?(skills|competencies|expertise|areas of expertise)$/i],
  ['projects', /^(projects|selected projects|personal projects)$/i],
  ['certifications', /^(certifications?|certificates?|licenses?( & certifications)?|courses)$/i],
  ['languages', /^languages?$/i],
  ['achievements', /^(achievements?|accomplishments?|awards?|honou?rs?( & awards)?)$/i],
  ['interests', /^(interests?|hobbies|hobbies (&|and) interests)$/i],
];

/** True for a section heading such as "Work experience" or "SKILLS:". */
const isHeading = str => {
  const clean = String(str).replace(/\*\*/g, '').replace(/[:|]+$/, '').replace(/\s+/g, ' ').trim();
  return !!clean && clean.length < 40 && HEADINGS.some(([, re]) => re.test(clean));
};

const BULLET = /^[•\-*▪◦●■‣]\s+/;
const MONTH = '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?,?';
const DATE = `(?:${MONTH}\\s*)?(?:19|20)\\d{2}`;
const DATE_RANGE = new RegExp(`(${DATE})\\s*(?:-|–|—|\\bto\\b)\\s*(${DATE}|present|current|now|today)`, 'i');
const DATE_ONLY = new RegExp(`^${DATE}$`, 'i');
const LABEL = /^(achievements|tasks|responsibilities|achievements\s*\/\s*tasks|key (achievements|responsibilities))\s*:?$/i;

const plain = s => s.replace(/\*\*/g, '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim();
const allBold = s => /^\*\*[^*]+\*\*$/.test(s.trim());
const sentenceEnd = s => /[.!?]["')\]]?$/.test(plain(s));
const capitalise = s => s.replace(/^\w/, c => c.toUpperCase());
/** Join wrapped lines into one; a word hyphenated at a line end is put back together. */
const joinLines = lines => lines
  .reduce((acc, l) => (acc && /[a-z]-(\*\*)?$/.test(acc) && /^(\*\*)?[a-z]/.test(l) ? acc + l : acc ? `${acc} ${l}` : l), '')
  .replace(/\*\*\*\*/g, '') // bold that continues across a hyphenated line break
  .replace(/\t/g, ' ')
  .replace(/\*\*\s+\*\*/g, ' ') // bold that continues over a line break is one run
  .replace(/\s+/g, ' ')
  .trim();
const paragraphs = lines => {
  const out = [[]];
  lines.forEach(l => (l === '' ? out.push([]) : out[out.length - 1].push(l)));
  return out.filter(p => p.length);
};
const chunks = (lines, splitAt) => lines.reduce((acc, l) => {
  if (!acc.length || splitAt(l, acc[acc.length - 1])) acc.push([]);
  acc[acc.length - 1].push(l);
  return acc;
}, []);

/** Bullets from the lines under a job: marked bullets, else paragraphs, else sentences. */
function toBullets(lines) {
  const body = lines.filter(l => !LABEL.test(plain(l)));
  const text = body.filter(Boolean);
  if (!text.length) return '';
  if (text.some(l => BULLET.test(l))) {
    return chunks(text, l => BULLET.test(l)).map(c => joinLines(c.map(l => l.replace(BULLET, '')))).join('\n');
  }
  const paras = paragraphs(body);
  if (paras.length > 1) return paras.map(joinLines).join('\n');
  // No markers and no spacing to go by: a bullet ends at a full stop that is followed by a capital letter.
  return chunks(text, (l, cur) => sentenceEnd(cur[cur.length - 1]) && /^(\*\*)?[A-Z0-9]/.test(l)).map(joinLines).join('\n');
}

function parseDates(line) {
  const m = plain(line).match(DATE_RANGE);
  if (!m) return null;
  const rest = plain(line).replace(DATE_RANGE, '').replace(/^[\s|,·•–—-]+|[\s|,·•–—-]+$/g, '');
  return { start: m[1].replace(/\s+/g, ' '), end: capitalise(m[2].replace(/\s+/g, ' ')), rest };
}

/** "Senior Designer<TAB>2021 – Present": the job title comes first and the dates sit apart on the right. */
function titleFirst(line) {
  const seg = line.split('	').map(s => s.trim()).filter(Boolean);
  return seg.length >= 2 && !DATE_RANGE.test(plain(seg[0])) && DATE_RANGE.test(plain(seg.slice(1).join(' ')));
}
/** Split a line at its wide gaps into [main text, text on the right]. */
const sides = line => {
  const [main = '', ...rest] = line.split('	');
  return [plain(main), plain(rest.join(' '))];
};

const newExp = () => ({ id: uid(), role: '', company: '', location: '', about: '', start: '', end: '', bullets: '' });

/** Jobs anchored on their date lines: the lines above a date are the role and employer, the lines below are bullets. */
function parseExperience(lines) {
  const isDateLine = l => { const d = parseDates(l); return !!d && d.rest.length < 60; };
  const dateIdx = lines.map((l, i) => (isDateLine(l) ? i : -1)).filter(i => i >= 0);
  if (!dateIdx.length) return parseExperienceLoose(lines);
  const bold = lines.some(allBold);
  // Where each job's header starts: walk up from the date line to the job title.
  const starts = dateIdx.map((d, n) => {
    if (titleFirst(lines[d])) return d;
    const floor = n ? dateIdx[n - 1] : -1;
    let i = d;
    let taken = 0;
    while (i - 1 > floor && taken < 5) {
      const l = lines[i - 1];
      if (l === '') {
        if (!taken || bold) { i--; continue; } // spacing inside a bold-titled header
        break;
      }
      if (BULLET.test(l) || LABEL.test(plain(l))) break;
      if (!bold && (sentenceEnd(l) || taken >= 2)) break; // without bold: at most a role and a company, never a sentence
      i--;
      taken++;
      if (bold && allBold(l)) break; // the job title
    }
    while (i < d && lines[i] === '') i++;
    return i;
  });
  return dateIdx.map((d, n) => {
    const e = newExp();
    const head = lines.slice(starts[n], d).filter(Boolean).map(plain);
    const dates = parseDates(lines[d]);
    e.start = dates.start;
    e.end = dates.end;
    let body = d + 1;
    if (titleFirst(lines[d])) {
      // The title is on the date line; the next line is "Company<TAB>Location" when it is not a bullet.
      e.role = sides(lines[d])[0];
      const end = n + 1 < dateIdx.length ? starts[n + 1] : lines.length;
      const skip = i => { while (i < end && lines[i] === '') i++; return i; };
      let i = skip(d + 1);
      if (i < end && !BULLET.test(lines[i]) && !sentenceEnd(lines[i]) && plain(lines[i]).length < 90) {
        [e.company, e.location] = sides(lines[i]);
        i = skip(i + 1);
        // When the bullets are marked, a plain line before the first one describes the company.
        const marked = lines.slice(i, end).some(l => BULLET.test(l));
        if (marked && i < end && !BULLET.test(lines[i]) && plain(lines[i]).length < 120) { e.about = plain(lines[i]); i++; }
        body = i;
      }
    } else if (head.length) {
      [e.role = '', e.company = ''] = head;
      e.about = head.slice(2).join(' ');
      e.location = dates.rest;
    } else {
      // "Engineer, Acme Corp  2019 – 2021" on one line
      [e.role = '', e.company = ''] = dates.rest.split(/\s+[|@—–-]\s+|\s+at\s+|,\s+/).map(s => s.trim());
    }
    e.bullets = toBullets(lines.slice(body, n + 1 < dateIdx.length ? starts[n + 1] : lines.length));
    return e;
  });
}

/** Experience without recognisable date lines: a new job starts at the first plain line after bullets. */
function parseExperienceLoose(lines) {
  const out = [];
  let item = null;
  for (const line of lines.filter(Boolean)) {
    if (BULLET.test(line)) {
      if (!item) out.push(item = newExp());
      item.bullets += (item.bullets ? '\n' : '') + line.replace(BULLET, '');
    } else if (item && item.bullets && /^[a-z]/.test(line)) {
      item.bullets += ` ${line}`; // wrapped bullet
    } else {
      if (!item || item.bullets) out.push(item = newExp());
      if (!item.role) item.role = plain(line);
      else if (!item.company) item.company = plain(line);
    }
  }
  return out;
}

function parseEducation(lines) {
  const text = lines.filter(Boolean);
  const bold = text.some(allBold);
  const dated = l => sides(l).some(s => DATE_ONLY.test(s) || DATE_RANGE.test(s));
  const groups = chunks(text, (l, cur) => (bold ? allBold(l) : dated(l) && cur.some(dated)));
  return groups.map(g => {
    const ed = { id: uid(), degree: '', school: '', location: '', start: '', end: '', details: '' };
    g.forEach(raw => {
      const [main, right] = sides(raw);
      for (const part of [main, right]) {
        if (!part) continue;
        const range = parseDates(part);
        if (range) {
          ed.start = range.start;
          ed.end = range.end;
          if (range.rest && !ed.degree) ed.degree = range.rest; else if (range.rest && !ed.location) ed.location = range.rest;
        } else if (DATE_ONLY.test(part)) ed.end = part;
        else if (part === right) ed.location = part;
        else if (!ed.degree) ed.degree = part;
        else if (!ed.school) ed.school = part;
        else ed.details += (ed.details ? ' ' : '') + part;
      }
    });
    return ed;
  }).filter(ed => ed.degree || ed.school);
}

/** Entries such as certificates: title (bold when the source has bold), then details, then a date line. */
function parseDatedEntries(lines) {
  const text = lines.filter(Boolean);
  const hasDates = text.some(l => DATE_ONLY.test(plain(l)));
  const bold = text.some(allBold);
  const groups = hasDates
    ? chunks(text, (l, cur) => DATE_ONLY.test(plain(cur[cur.length - 1])))
    : bold ? chunks(text, (l, cur) => allBold(l) && !cur.every(allBold)) : text.map(l => [l]);
  return groups.map(g => {
    const date = g.filter(l => DATE_ONLY.test(plain(l))).map(plain).join(' ');
    const rest = g.filter(l => !DATE_ONLY.test(plain(l)));
    const boldLines = rest.filter(allBold);
    const titleLines = bold && boldLines.length ? boldLines : rest.slice(0, 1);
    const title = joinLines(titleLines.map(plain));
    const detail = joinLines(rest.filter(l => !titleLines.includes(l)).map(plain));
    return [title, detail, date];
  }).filter(([title]) => title);
}

const entryLine = parts => parts.map(p => p.replace(/\|/g, '/')).join(' | ').replace(/( \| )+$/, '');

function parseLanguages(lines) {
  // One per line, or several on a line: "English – Native · Spanish – Professional working".
  const text = lines.filter(Boolean).flatMap(l => l.split(/\t|\s+·\s+|\s*;\s*/)).map(s => s.trim()).filter(Boolean);
  const out = [];
  text.forEach(raw => {
    const l = plain(raw.replace(BULLET, ''));
    const last = out[out.length - 1];
    // "English" then "Full Professional Proficiency" on the next line
    if (last && !last[1] && languageLevel(l) && !/[:(–—-]/.test(l)) { last[1] = l; return; }
    const m = l.match(/^([^:(–—-]+?)\s*(?:[:(–—-]\s*(.+?)\)?)?$/);
    out.push(m && m[2] ? [m[1].trim(), m[2].trim()] : [l, '']);
  });
  return out.map(entryLine).join('\n');
}

function parseAchievements(lines) {
  const text = lines.filter(Boolean);
  const bold = text.some(allBold);
  const groups = chunks(text, (l, cur) => {
    if (DATE_ONLY.test(plain(cur[cur.length - 1]))) return true;
    return bold && allBold(l) && !cur.every(allBold);
  });
  return groups.map(g => {
    const date = g.filter(l => DATE_ONLY.test(plain(l))).map(plain).join(' ');
    const rest = g.filter(l => !DATE_ONLY.test(plain(l)));
    const firstPlain = bold ? rest.findIndex(l => !allBold(l)) : 1;
    const cut = firstPlain < 0 ? rest.length : firstPlain;
    return { id: uid(), title: joinLines(rest.slice(0, cut).map(plain)), date, description: joinLines(rest.slice(cut).map(l => l.replace(BULLET, ''))) };
  }).filter(a => a.title || a.description);
}

/**
 * Items of a list such as skills or interests. Written inline ("Figma · Design Systems · Journey")
 * the list can wrap mid-item, so its lines are joined first; written one per line (or as chips set
 * apart by wide gaps), each line or part is an item.
 */
function listItems(lines) {
  const text = lines.filter(Boolean).map(l => l.replace(BULLET, ''));
  const inline = text.filter(l => /[|•·,;]/.test(l)).length >= text.length / 2;
  const source = inline ? [text.join(' ')] : text;
  return source.flatMap(l => l.split(/\t|\s*[|•·,;]\s*/)).map(plain).filter(Boolean);
}

/** Name, headline, contact details and (when it has no heading of its own) the summary. */
function parseHeader(lines, text, r) {
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phone = text.match(/\+?\d[\d\s().-]{7,}\d/);
  const linkedin = text.match(/linkedin\.com\/[^\s|,]+/i);
  const github = text.match(/github\.com\/[^\s|,]+/i);
  if (email) r.personal.email = email[0].toLowerCase();
  if (phone) r.personal.phone = phone[0].trim();
  if (linkedin) r.personal.linkedin = linkedin[0];
  if (github) r.personal.github = github[0];

  // Each part of the header (lines, split at wide gaps) is either a contact detail or text. Parts are
  // told apart by what they look like, not by where they are, because templates put the contact
  // details below, beside or even above the name.
  const isPlace = p => p.length < 40 && /^[\p{L} .'-]+,\s*[\p{L} .'-]+$/u.test(p);
  const isHandle = p => /^[A-Za-z0-9][A-Za-z0-9-]{2,38}$/.test(p) && (/[-\d]/.test(p) || /^[a-z]/.test(p) || /[a-z][A-Z]/.test(p));
  const isContact = p => /@/.test(p) || /\+?\d[\d\s().-]{7,}\d/.test(p) || /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(p)
    || isPlace(p) || isHandle(p);
  const parts = lines.filter(Boolean).flatMap(l => l.split(/\t|\s+[|•·]\s+/)).map(plain).filter(Boolean);
  const words = parts.filter(p => !isContact(p));
  // The name: the first text that reads like one (a few capitalised words, no digits, not a sentence).
  const looksLikeName = p => /^\p{Lu}/u.test(p) && /\s/.test(p) && !/\d/.test(p) && p.split(/\s+/).length <= 5 && !sentenceEnd(p);
  const at = Math.max(0, words.findIndex(looksLikeName));
  r.personal.name = words[at] || '';
  const second = words[at + 1] || '';
  const hasTitle = second && second.length < 60 && !sentenceEnd(second);
  if (hasTitle) r.personal.title = second;
  const summary = words.slice(at + (hasTitle ? 2 : 1));
  if (summary.length) r.summary = plain(joinLines(summary));

  // Contact details. A "City, Country" part is the location; bare handles (shown next to an icon,
  // without the site's name) are taken as LinkedIn (lower case with hyphens) or GitHub.
  const tokens = parts.filter(isContact);
  tokens.forEach(tok => {
    if (/@/.test(tok) || /\d{4}/.test(tok)) return;
    if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(tok)) {
      if (!/linkedin|github/i.test(tok) && !r.personal.website) r.personal.website = tok;
      return;
    }
    if (!r.personal.location && /^[\p{L} .'-]+,\s*[\p{L} .'-]+$/u.test(tok)) { r.personal.location = tok; return; }
    if (/^[A-Za-z0-9][A-Za-z0-9-]{2,38}$/.test(tok)) {
      if (!r.personal.linkedin && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(tok)) r.personal.linkedin = `linkedin.com/in/${tok}`;
      else if (!r.personal.github) r.personal.github = `github.com/${tok}`;
    }
  });
}

/** Best-effort conversion of CV text into structured fields. The result is meant to be reviewed. */
export function parseResumeText(text) {
  const r = blankResume();
  Object.keys(r.personal).forEach(k => { r.personal[k] = ''; }); // an imported CV is someone's own details, not the local defaults
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n').map(s => s.replace(/[ \u00a0]+/g, ' ').trim());

  const buckets = { header: [] };
  let current = 'header';
  const split = lines.flatMap(l => {
    const [first, ...rest] = l.split('	');
    return rest.length && isHeading(first) ? [first, rest.join('	')] : [l];
  });
  for (const line of split) {
    const h = isHeading(line) && HEADINGS.find(([, re]) => re.test(plain(line).replace(/[:|]+$/, '').trim()));
    if (h) { current = h[0]; buckets[current] = buckets[current] || []; continue; }
    buckets[current].push(line);
  }

  parseHeader(buckets.header, String(text ?? ''), r);
  if (buckets.summary) r.summary = plain(joinLines(buckets.summary.filter(Boolean)));
  if (buckets.experience) r.experience = parseExperience(buckets.experience).filter(e => e.role || e.company || e.bullets);
  if (buckets.education) r.education = parseEducation(buckets.education);
  if (buckets.skills) r.skills = [...new Set(listItems(buckets.skills))].join(', ');
  if (buckets.projects) {
    r.projects = buckets.projects.filter(l => l && !BULLET.test(l)).slice(0, 8).map(l => ({ id: uid(), name: plain(l), link: '', description: '' }));
  }
  if (buckets.certifications) r.certifications = parseDatedEntries(buckets.certifications.map(l => l.replace(BULLET, ''))).map(entryLine).join('\n');
  if (buckets.languages) r.languages = parseLanguages(buckets.languages);
  if (buckets.achievements) r.achievements = parseAchievements(buckets.achievements);
  if (buckets.interests) r.interests = listItems(buckets.interests).join(', ');

  r.title = r.personal.name ? `${r.personal.name} — imported` : 'Imported CV';
  return r;
}
