// PDF export, fully in the browser.
//
// How a PDF is built:
//   1. Render the document off-screen at page size (the same renderer as the preview), and move blocks
//      that a page break would cut to the next page (paginate.js).
//   2. Capture the page as a picture (html2canvas): backgrounds, bands, chips, icons and the photo.
//   3. Encode each page picture as an indexed-colour PNG (a small palette, lossless edges); the photo
//      is cut out and stored as its own small JPEG. See docs/design-rationale.md.
//   4. Text. When the document's font can be embedded (pdf-text.js), the picture is taken with all
//      text transparent and every word is written as real text in that font: sharp at any zoom,
//      small, and read by applicant tracking systems as text. Otherwise the picture includes the
//      text, and invisible word-positioned text is laid over it so the PDF can still be searched.
//   5. Add a clickable area over every link (email, website, LinkedIn, GitHub).
import { renderDoc } from './templates.js';
import { LETTER_TITLE, pageSize } from './data.js';
import { paginate } from './paginate.js';
import { loadLib } from './platform.js';
import { canWriteText, keepDecorations, PSEUDO_COLOURS, GRAPHICS_OFF, loadFonts, writeText, drawGraphics } from './pdf-text.js';

/**
 * Encoding settings. `colors` is the palette size per page; `scale` is bitmap pixels per CSS pixel;
 * `text` is 'auto' (real text when the font can be embedded) or 'image' (always a picture of the text).
 */
export const PDF_DEFAULTS = Object.freeze({ scale: 2, encoder: 'indexed', colors: 48, jpegQuality: 0.82, text: 'auto' });

/** CSS for the page picture when the text is written separately: text and list bullets are left out. */
// (html2canvas turns ::before / ::after into html2canvaspseudoelement elements; those are decoration
// and keep their colour, see keepDecorations.)
const HIDE_TEXT = '.pdf-vector, .pdf-vector *:not(svg):not(svg *):not(html2canvaspseudoelement) { color: transparent !important; text-shadow: none !important; }'
  + ' .pdf-vector li::marker { color: transparent !important; }';

// PDF standard fonts only encode Latin-1; map common typographic characters for the hidden text layer.
export const latin1 = s => s
  .replace(/[\u2018\u2019\u201a\u2032]/g, "'")   // single quotes, prime
  .replace(/[\u201c\u201d\u201e\u2033]/g, '"')   // double quotes
  .replace(/[\u2013\u2014\u2212]/g, '-')          // dashes, minus
  .replace(/\u2026/g, '...')                         // ellipsis
  .replace(/[\u2022\u25aa\u25cf]/g, '-')          // bullets (the middle dot \u00b7 is Latin-1 and kept)
  .replace(/\u00a0/g, ' ')                           // non-breaking space
  .replace(/[^\x20-\xff]/g, '');

/**
 * Select the PDF page that a baseline at `y` (CSS px from the top of the document) falls on, and
 * return the baseline's position on that page. Chosen by the baseline, not the top of the text, so a
 * line that straddles a page break is never written below the bottom edge of a page (where readers
 * drop it).
 */
function onPage(pdf, y, pageCssH) {
  const pageNo = Math.min(Math.max(0, Math.floor(y / pageCssH)), pdf.getNumberOfPages() - 1);
  pdf.setPage(pageNo + 1);
  return y - pageNo * pageCssH;
}

/** Invisible text over the page image, one word at a time, at the position it has on screen. */
function addTextLayer(pdf, page, pageCssH, ptPerPx) {
  const origin = page.getBoundingClientRect();
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  pdf.setFont('helvetica', 'normal');
  const marked = new Set(); // list items whose bullet has been written
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const li = node.parentElement.closest('li');
    if (li && !marked.has(li) && getComputedStyle(li).listStyleType !== 'none') {
      // The bullet is drawn by CSS and is not text; write one so the PDF's text keeps the list
      // (copying the text, or importing the PDF again, then shows where each bullet starts).
      marked.add(li);
      range.selectNodeContents(node);
      const r = range.getClientRects()[0];
      if (r) {
        const baseline = onPage(pdf, r.top - origin.top + r.height * 0.78, pageCssH);
        pdf.setFontSize(Math.max(4, r.height * 0.75 * ptPerPx));
        pdf.text('- ', (r.left - origin.left - 10) * ptPerPx, baseline * ptPerPx, { renderingMode: 'invisible' });
      }
    }
    const upper = getComputedStyle(node.parentElement).textTransform === 'uppercase';
    for (const m of node.nodeValue.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const word = latin1(upper ? m[0].toUpperCase() : m[0]);
      if (!word) continue;
      const baseline = onPage(pdf, r.top - origin.top + r.height * 0.78, pageCssH);
      pdf.setFontSize(Math.max(4, r.height * 0.75 * ptPerPx));
      // Stretch the word to its on-screen width so selections line up with the picture.
      const natural = pdf.getTextWidth(word);
      const target = r.width * ptPerPx;
      // Trailing space keeps words apart when the text is copied or parsed.
      pdf.text(`${word} `, (r.left - origin.left) * ptPerPx, baseline * ptPerPx, {
        renderingMode: 'invisible',
        horizontalScale: natural ? Math.min(3, Math.max(0.3, target / natural)) : 1,
      });
    }
  }
}

/** Clickable areas over the page image for every link (email, website, LinkedIn, GitHub). */
function addLinks(pdf, page, pageCssH, ptPerPx) {
  const origin = page.getBoundingClientRect();
  page.querySelectorAll('a[href]').forEach(a => {
    if (!/^(https?|mailto):/i.test(a.href)) return;
    for (const r of a.getClientRects()) {
      if (!r.width || !r.height) continue;
      const baseline = onPage(pdf, r.top - origin.top + r.height * 0.78, pageCssH);
      const top = baseline - r.height * 0.78;
      pdf.link((r.left - origin.left) * ptPerPx, top * ptPerPx, r.width * ptPerPx, r.height * ptPerPx, { url: a.href });
    }
  });
}

/**
 * Photographs on the page, each cut out of the page bitmap as its own small JPEG. The page image
 * keeps its small palette (a photo would need the full 256 colours, and still band in skin tones),
 * and the photo is laid over it in the PDF, clipped to its circle so no square edge shows. Under the
 * photo the page image gets a flat disc in the photo's outer ring colour, which compresses well.
 * @returns {{x: number, y: number, w: number, h: number, round: boolean, fill: string, jpeg: string}[]} in bitmap pixels
 */
function cutOutPhotos(page, canvas, opts) {
  const origin = page.getBoundingClientRect();
  return [...page.querySelectorAll('img.r-photo')].map(img => {
    const r = img.getBoundingClientRect();
    const x = Math.max(0, Math.floor((r.left - origin.left) * opts.scale));
    const y = Math.max(0, Math.floor((r.top - origin.top) * opts.scale));
    const w = Math.min(canvas.width - x, Math.ceil(r.width * opts.scale));
    const h = Math.min(canvas.height - y, Math.ceil(r.height * opts.scale));
    const cut = document.createElement('canvas');
    cut.width = w;
    cut.height = h;
    const ctx = cut.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
    // The colour of the outer ring, a little inside its edge (the edge itself is blended with the page).
    const ring = Math.max(1, Math.round(parseFloat(getComputedStyle(img).borderTopWidth) * opts.scale / 2));
    const [red, green, blue] = ctx.getImageData(Math.floor(w / 2), ring, 1, 1).data;
    const radius = getComputedStyle(img).borderTopLeftRadius; // "50%" or a length
    const round = (radius.endsWith('%') ? (parseFloat(radius) / 100) * r.width : parseFloat(radius)) >= r.width / 2 - 1;
    return { x, y, w, h, round, fill: `rgb(${red},${green},${blue})`, jpeg: cut.toDataURL('image/jpeg', 0.9) };
  }).filter(p => p.w > 0 && p.h > 0);
}

/** Fill the photo's place in the page image (a disc for a round photo, slightly larger to cover its edge). */
function blankPhoto(ctx, p, top) {
  ctx.fillStyle = p.fill;
  if (!p.round) { ctx.fillRect(p.x, p.y - top, p.w, p.h); return; }
  ctx.beginPath();
  ctx.arc(p.x + p.w / 2, p.y - top + p.h / 2, p.w / 2 + 1, 0, Math.PI * 2);
  ctx.fill();
}

/** Lay the photo over the page image; a round photo is clipped to its circle. */
function placePhoto(pdf, p, top, k) {
  const x = p.x * k, y = (p.y - top) * k, w = p.w * k, h = p.h * k;
  if (!p.round) { pdf.addImage(p.jpeg, 'JPEG', x, y, w, h); return; }
  // The clipping circle is written as PDF operators (four Bézier arcs, then "W n"): jsPDF's own
  // circle() writes no path when it is asked not to paint one.
  // Clipped a little inside the photo's edge: the outermost pixels are blended with the page behind,
  // and the flat disc under the photo (blankPhoto) gives the clean outer edge instead.
  const cx = x + w / 2, cy = pdf.internal.pageSize.getHeight() - (y + h / 2), r = w / 2 - 1.5 * k, c = r * 0.5523;
  const n = v => v.toFixed(2);
  pdf.internal.write([
    'q',
    `${n(cx + r)} ${n(cy)} m`,
    `${n(cx + r)} ${n(cy + c)} ${n(cx + c)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
    `${n(cx - c)} ${n(cy + r)} ${n(cx - r)} ${n(cy + c)} ${n(cx - r)} ${n(cy)} c`,
    `${n(cx - r)} ${n(cy - c)} ${n(cx - c)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
    `${n(cx + c)} ${n(cy - r)} ${n(cx + r)} ${n(cy - c)} ${n(cx + r)} ${n(cy)} c`,
    'W n',
  ].join('\n'));
  pdf.addImage(p.jpeg, 'JPEG', x, y, w, h);
  pdf.internal.write('Q');
}

/** Encode one page bitmap. Returns { data, format } for jsPDF.addImage. */
async function encodePage(canvas, opts) {
  if (opts.encoder === 'indexed') {
    await loadLib('pako'); // UPNG needs it for deflate
    const UPNG = await loadLib('upng');
    const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return { data: new Uint8Array(UPNG.encode([rgba.buffer], canvas.width, canvas.height, opts.colors)), format: 'PNG' };
  }
  return { data: canvas.toDataURL('image/jpeg', opts.jpegQuality), format: 'JPEG' };
}

/**
 * Build a PDF for `doc`. `area` is the hidden off-screen render target.
 * Resolves { blob, pages, text }: `text` says whether the words are real text ('text') or part of the
 * page picture ('image'). Throws with a readable message when a library or font cannot be loaded.
 */
export async function buildPdf(doc, area, { title = '', ...overrides } = {}) {
  const opts = { ...PDF_DEFAULTS, ...overrides };
  const size = pageSize(doc);
  const html2canvas = await loadLib('html2canvas');
  const { jsPDF } = await loadLib('jspdf');
  area.innerHTML = renderDoc(doc);
  area.style.width = `${size.W}px`;
  area.classList.add('rendering');
  try {
    await document.fonts.ready;
    const page = area.querySelector('.page');
    const vector = opts.text !== 'image' && canWriteText(page);
    if (vector) {
      keepDecorations(page);
      // Icons take their colour from the text around them; keep it when the text is made transparent.
      page.querySelectorAll('svg').forEach(svg => { svg.style.color = getComputedStyle(svg).color; });
    }
    paginate(page, size.H); // page breaks fall between blocks, never through a line
    const fullH = Math.max(page.scrollHeight, size.H);
    const canvas = await html2canvas(page, {
      scale: opts.scale, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, logging: false,
      width: size.W, height: fullH, windowWidth: size.W, windowHeight: fullH, // the whole page, not just the visible frame
      onclone: vector ? (cloned, el) => {
        const style = cloned.createElement('style');
        style.textContent = HIDE_TEXT + PSEUDO_COLOURS + GRAPHICS_OFF;
        cloned.head.appendChild(style);
        el.classList.add('pdf-vector');
      } : undefined,
    });
    const pdf = new jsPDF({ unit: 'pt', format: size.pdf, compress: true });
    pdf.setProperties({ title, author: doc.personal?.name || '', creator: 'Craftfolio' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const ptPerBitmapPx = pw / canvas.width;
    const sliceH = Math.floor(canvas.width * (ph / pw)); // bitmap rows per PDF page
    // With real text the photo is drawn from its own image (drawGraphics); otherwise it is cut out here.
    const photos = opts.encoder === 'indexed' && !vector ? cutOutPhotos(page, canvas, opts) : [];
    let pages = 0;
    for (let y = 0; y < canvas.height - 4; y += sliceH, pages++) {
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.min(sliceH, canvas.height - y);
      const ctx = part.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
      const onThisPage = photos.filter(p => p.y >= y && p.y < y + part.height);
      onThisPage.forEach(p => blankPhoto(ctx, p, y));
      const img = await encodePage(part, opts);
      if (pages) pdf.addPage();
      pdf.addImage(img.data, img.format, 0, 0, pw, part.height * ptPerBitmapPx, undefined, 'FAST');
      onThisPage.forEach(p => placePhoto(pdf, p, y, ptPerBitmapPx));
    }
    const pageCssH = size.W * (ph / pw), ptPerPx = pw / size.W;
    if (vector) {
      const place = y => onPage(pdf, y, pageCssH);
      const fontFor = await loadFonts(pdf, page);
      await drawGraphics(pdf, page, place, ptPerPx);
      writeText(pdf, page, fontFor, place, ptPerPx);
    } else {
      addTextLayer(pdf, page, pageCssH, ptPerPx);
    }
    addLinks(pdf, page, pageCssH, ptPerPx);
    return { blob: pdf.output('blob'), pages, text: vector ? 'text' : 'image' };
  } finally {
    area.classList.remove('rendering');
    area.innerHTML = '';
  }
}

/** Suggested file name (without extension) for a document. */
export function pdfName(doc) {
  const cover = doc.type === 'cover';
  const named = doc.title && doc.title !== LETTER_TITLE; // a letter is named after its recipient, or by the user
  const base = cover && named ? doc.title
    : doc.personal?.name ? `${doc.personal.name} ${cover ? 'Cover Letter' : 'CV'}` : doc.title;
  return String(base || '').replace(/[^\w\s-]+/g, '').replace(/\s+/g, ' ').trim() || 'document';
}
