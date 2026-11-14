// PDF export, fully in the browser.
//
// How a PDF is built:
//   1. Render the document off-screen at A4 size (the same renderer as the preview).
//   2. Capture it as a bitmap (html2canvas) so the PDF looks exactly like the preview, fonts included.
//   3. Encode each page as an indexed-colour PNG (a small palette, lossless edges), which is far
//      smaller than a JPEG for a page of text and keeps letters sharp. See docs/design-rationale.md.
//   4. Lay invisible, word-positioned text over the image so the PDF is selectable, searchable and
//      readable by applicant tracking systems.
//   5. Add a clickable area over every link (email, website, LinkedIn, GitHub).
import { renderDoc } from './templates.js';
import { LETTER_TITLE, pageSize, validPhoto } from './data.js';
import { loadLib } from './platform.js';

/** Encoding settings. `colors` is the palette size per page; `scale` is bitmap pixels per CSS pixel. */
export const PDF_DEFAULTS = Object.freeze({ scale: 2, encoder: 'indexed', colors: 48, jpegQuality: 0.82 });

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
 * Resolves { blob, pages }. Throws with a readable message when a library cannot be loaded.
 */
export async function buildPdf(doc, area, { title = '', ...overrides } = {}) {
  // A photo needs the full 256-colour palette; 48 colours would show bands in skin tones.
  const photo = validPhoto(doc.personal?.photo) ? { colors: 256 } : {};
  const opts = { ...PDF_DEFAULTS, ...photo, ...overrides };
  const size = pageSize(doc);
  const html2canvas = await loadLib('html2canvas');
  const { jsPDF } = await loadLib('jspdf');
  area.innerHTML = renderDoc(doc);
  area.style.width = `${size.W}px`;
  area.classList.add('rendering');
  try {
    await document.fonts.ready;
    const page = area.querySelector('.page');
    const fullH = Math.max(page.scrollHeight, size.H);
    const canvas = await html2canvas(page, {
      scale: opts.scale, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, logging: false,
      width: size.W, height: fullH, windowWidth: size.W, windowHeight: fullH, // the whole page, not just the visible frame
    });
    const pdf = new jsPDF({ unit: 'pt', format: size.pdf, compress: true });
    pdf.setProperties({ title, author: doc.personal?.name || '', creator: 'Craftfolio' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const sliceH = Math.floor(canvas.width * (ph / pw)); // bitmap rows per PDF page
    let pages = 0;
    for (let y = 0; y < canvas.height - 4; y += sliceH, pages++) {
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.min(sliceH, canvas.height - y);
      const ctx = part.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
      const img = await encodePage(part, opts);
      if (pages) pdf.addPage();
      pdf.addImage(img.data, img.format, 0, 0, pw, part.height * (pw / canvas.width), undefined, 'FAST');
    }
    addTextLayer(pdf, page, size.W * (ph / pw), pw / size.W);
    addLinks(pdf, page, size.W * (ph / pw), pw / size.W);
    return { blob: pdf.output('blob'), pages };
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
