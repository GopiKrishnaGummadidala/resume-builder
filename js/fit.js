// One page for cover letters: measure how many pages a document takes and, when a letter spills
// over, tighten its spacing and then its margins (on a copy) until it fits.
import { renderDoc } from './templates.js';
import { paginate } from './paginate.js';
import { pageSize } from './data.js';

/** Pages `doc` takes, laid out off screen exactly as the PDF lays it out. */
export function pageCount(doc) {
  const size = pageSize(doc);
  const host = document.createElement('div');
  host.style.cssText = `position:absolute;left:-100000px;top:0;width:${size.W}px;visibility:hidden;pointer-events:none`;
  host.setAttribute('aria-hidden', 'true');
  host.innerHTML = renderDoc(doc);
  document.body.appendChild(host);
  try {
    const page = host.querySelector('.page');
    return page ? paginate(page, size.H) : 1;
  } finally {
    host.remove();
  }
}

/**
 * `doc` on one page: unchanged when it already fits, else a copy with tighter spacing, then tighter
 * margins (the Layout steps, down to the smallest). `pages` > 1 means even the tightest layout overflows.
 * @returns {{doc: object, pages: number, changed: boolean}}
 */
export function fitOnePage(doc) {
  let pages = pageCount(doc);
  if (pages <= 1) return { doc, pages, changed: false };
  const t = structuredClone(doc);
  t.theme = { ...t.theme };
  for (const key of ['spacing', 'margin']) {
    while ((t.theme[key] ?? 1) > 1) {
      t.theme[key] = (t.theme[key] ?? 1) - 1;
      pages = pageCount(t);
      if (pages <= 1) return { doc: t, pages, changed: true };
    }
  }
  return { doc: t, pages, changed: true };
}
