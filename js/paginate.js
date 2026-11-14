// Page breaks. A document is drawn as one tall page and cut into pages of a fixed height for the PDF.
// Without care, the cut falls wherever a page fills up and can split a line of text, a job's title
// from its company, or a heading from what follows it. paginate() moves such blocks down to the top
// of the next page (by adding to their top margin) so that every cut falls between blocks, with a
// margin at the top and bottom of every page after the first.
//
// It works on the rendered page, so it runs in the browser: before a PDF is captured, and on the
// live preview so the preview shows the same pages.

/** Blocks that must not be split, in the order they are checked. */
const BLOCKS = [
  '.r-side > .r-sec',         // a side card or side section, when it fits in the space of one page
  '.r-sec > .r-h',            // a section heading, kept with the first line after it
  '.r-item',                  // an entry's title, employer and dates, kept with its first bullet
  '.page li',                 // one bullet, one skill, one language
  '.r-p, .r-about',           // a paragraph
  '.r-chips',                 // a row of skill chips
  '.l-body > p, .l-banner > p, .l-edit > p, .l-h, .b-to, .b-close, .l-close', // letter paragraphs, address, closing
];

/** Top and bottom page margins (CSS px) used after a page break. */
export const BREAK_MARGINS = Object.freeze({ top: 22, bottom: 26 });

const PUSHED = 'data-pb';

/** Undo an earlier pagination of `root` (all of it, or the part inside an editor being typed in). */
export function unpaginate(root) {
  root.querySelectorAll(`[${PUSHED}]`).forEach(el => {
    el.style.marginTop = el.getAttribute(PUSHED) === '-' ? '' : el.getAttribute(PUSHED);
    el.removeAttribute(PUSHED);
  });
  root.querySelectorAll('.page-no, .r-h-cont').forEach(added => added.remove());
  if (root.matches?.('[data-page-numbers]')) root.style.minHeight = '';
}

/**
 * "Page 1 of 2" at the foot of every page, for templates that ask for it (data-page-numbers). The
 * page is made a whole number of pages tall so the last footer sits at the foot of the last page.
 */
function numberPages(page, pageH, pages) {
  if (pages < 2) return;
  page.style.minHeight = `${pages * pageH}px`;
  for (let k = 1; k <= pages; k++) {
    const no = document.createElement('div');
    no.className = 'page-no';
    no.textContent = `Page ${k} of ${pages}`;
    no.style.top = `${k * pageH - 22}px`;
    page.appendChild(no);
  }
}

/**
 * Move blocks of `page` that would be cut by a page break down to the next page.
 * @param {HTMLElement} page the rendered `.page`; it may be scaled with a CSS transform
 * @param {number} pageH height of one page in CSS px
 * @returns {number} the number of pages
 */
export function paginate(page, pageH, { top = BREAK_MARGINS.top, bottom = BREAK_MARGINS.bottom } = {}) {
  unpaginate(page);
  const scale = page.getBoundingClientRect().height / page.offsetHeight || 1;
  const origin = () => page.getBoundingClientRect().top;
  const box = el => {
    const r = el.getBoundingClientRect();
    return { top: (r.top - origin()) / scale, bottom: (r.bottom - origin()) / scale };
  };
  const usable = pageH - top - bottom;
  const whole = []; // side cards kept whole: what is inside them is not checked again

  // Document order, top to bottom: moving a block moves everything after it, so each block is
  // measured only after the blocks before it have been placed.
  for (const el of page.querySelectorAll(BLOCKS.join(','))) {
    if (whole.some(w => w.contains(el))) continue;
    const span = extent(el, box);
    if (!span || span.bottom - span.top > usable) continue; // too tall to keep whole: it may split inside
    if (el.matches(BLOCKS[0])) whole.push(el);
    for (let b = pageH; b - bottom < span.bottom; b += pageH) {
      if (span.top >= b + top) continue;
      if (span.bottom > b - bottom) {
        // An entry that continues a section on a new page gets the section's heading repeated above it.
        const heading = el.matches('.r-item') && el.previousElementSibling?.matches('.r-item')
          && el.closest('.r-sec')?.querySelector(':scope > .r-h');
        if (heading) {
          const copy = heading.cloneNode(true);
          copy.classList.add('r-h-cont');
          copy.setAttribute('aria-hidden', 'true');
          copy.querySelectorAll('button').forEach(button => button.remove());
          el.before(copy);
          push(copy, b + top - box(copy).top, box);
        } else {
          push(el, b + top - span.top, box);
        }
        break;
      }
    }
  }
  const pages = Math.max(1, Math.ceil((page.scrollHeight - 2) / pageH));
  if (page.hasAttribute('data-page-numbers')) numberPages(page, pageH, pages);
  return pages;
}

/**
 * The part of a block that must stay together, and the element to move: a heading with the first
 * line after it, an entry's header with its first bullet, anything else as it is.
 */
function extent(el, box) {
  const own = box(el);
  if (!own.bottom || own.bottom <= own.top) return null;
  if (el.matches('.r-sec > .r-h')) {
    const next = el.nextElementSibling;
    const first = next?.querySelector('li, .r-row, p, span') || next;
    return { top: own.top, bottom: first ? Math.max(own.bottom, box(first).bottom) : own.bottom };
  }
  if (el.matches('.r-item')) {
    const firstBullet = el.querySelector('li');
    return { top: own.top, bottom: firstBullet ? box(firstBullet).bottom : own.bottom };
  }
  return own;
}

/**
 * Move `el` down by `by` px. A top margin can merge with the bottom margin of the block above it
 * (margin collapsing), so the move is measured and corrected until the block is where it should be.
 */
function push(el, by, box) {
  if (by <= 0) return;
  const target = el.matches('.r-sec > .r-h') ? el.parentElement : el;
  if (!target.hasAttribute(PUSHED)) target.setAttribute(PUSHED, target.style.marginTop || '-');
  const goal = box(el).top + by;
  for (let i = 0; i < 4; i++) {
    const missing = goal - box(el).top;
    if (missing < 0.5) break;
    const current = parseFloat(getComputedStyle(target).marginTop) || 0;
    target.style.marginTop = `${current + missing}px`;
  }
}
