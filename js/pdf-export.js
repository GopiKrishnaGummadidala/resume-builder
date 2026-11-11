// PDF export, fully in the browser.
//
// How a PDF is built:
//   1. Render the document off-screen at A4 size (the same renderer as the preview).
//   2. Capture it as a bitmap (html2canvas) so the PDF looks exactly like the preview, fonts included.
//   3. Encode each page as an indexed-colour PNG (a small palette, lossless edges), which is far
//      smaller than a JPEG for a page of text and keeps letters sharp. See docs/design-rationale.md.
//   4. Lay invisible, word-positioned text over the image so the PDF is selectable, searchable and
//      readable by applicant tracking systems.
import { renderDoc, PAGE } from './templates.js';
import { loadLib } from './platform.js';

/** Encoding settings. `colors` is the palette size per page; `scale` is bitmap pixels per CSS pixel. */
export const PDF_DEFAULTS = Object.freeze({ scale: 2, encoder: 'indexed', colors: 48, jpegQuality: 0.82 });

// PDF standard fonts only encode Latin-1; map common typographic characters for the hidden text layer.
export const latin1 = s => s
  .replace(/[\u2018\u2019\u201a\u2032]/g, "'")   // single quotes, prime
  .replace(/[\u201c\u201d\u201e\u2033]/g, '"')   // double quotes
  .replace(/[\u2013\u2014\u2212]/g, '-')          // dashes, minus
  .replace(/\u2026/g, '...')                         // ellipsis
  .replace(/[\u2022\u00b7\u25aa\u25cf]/g, '-')    // bullets
  .replace(/\u00a0/g, ' ')                           // non-breaking space
  .replace(/[^\x20-\xff]/g, '');

/** Invisible text over the page image, one word at a time, at the position it has on screen. */
function addTextLayer(pdf, page, pageCssH, ptPerPx) {
  const origin = page.getBoundingClientRect();
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const range = document.createRange();
  pdf.setFont('helvetica', 'normal');
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const upper = getComputedStyle(node.parentElement).textTransform === 'uppercase';
    for (const m of node.nodeValue.matchAll(/\S+/g)) {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const word = latin1(upper ? m[0].toUpperCase() : m[0]);
      if (!word) continue;
      const top = r.top - origin.top;
      const pageNo = Math.floor(top / pageCssH);
      const baseline = top - pageNo * pageCssH + r.height * 0.78;
      pdf.setPage(pageNo + 1);
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
  const opts = { ...PDF_DEFAULTS, ...overrides };
  const html2canvas = await loadLib('html2canvas');
  const { jsPDF } = await loadLib('jspdf');
  area.innerHTML = renderDoc(doc);
  area.classList.add('rendering');
  try {
    await document.fonts.ready;
    const page = area.querySelector('.page');
    const fullH = Math.max(page.scrollHeight, PAGE.H);
    const canvas = await html2canvas(page, {
      scale: opts.scale, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0, logging: false,
      width: PAGE.W, height: fullH, windowWidth: PAGE.W, windowHeight: fullH, // the whole page, not just the visible frame
    });
    const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true });
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
    addTextLayer(pdf, page, PAGE.W * (ph / pw), pw / PAGE.W);
    return { blob: pdf.output('blob'), pages };
  } finally {
    area.classList.remove('rendering');
    area.innerHTML = '';
  }
}

/** Suggested file name (without extension) for a document. */
export const pdfName = doc =>
  (doc.personal?.name ? `${doc.personal.name} ${doc.type === 'cover' ? 'Cover Letter' : 'CV'}` : doc.title)
    .replace(/[^\w\s-]+/g, '').trim() || 'document';
