// Page previews: every preview is a real A4 ".page" scaled down with a CSS transform to fit its box.
import { renderDoc } from './templates.js';
import { $, $$ } from './ui.js';

/** Scale every .page inside `root` to fit its container width. */
export function fitPages(root = document) {
  $$('.page-fit', root).forEach(box => {
    const page = $('.page', box);
    if (!page) return;
    // offsetWidth/offsetHeight are the page's own size (A4 or US Letter), unaffected by the transform.
    const scale = Math.min(1, box.clientWidth / page.offsetWidth);
    page.style.transform = `scale(${scale})`;
    box.style.height = `${page.offsetHeight * scale}px`;
  });
}
/** Re-fits previews when their container resizes. Views observe their own boxes. */
export const pageObserver = new ResizeObserver(() => fitPages());
window.addEventListener('resize', () => fitPages());

/**
 * A small, non-interactive picture of a document for cards. Its contact links become plain spans:
 * the card itself is a link, and a link inside a link makes the browser close the card's link early,
 * which pushed the preview out of its box.
 */
export function miniPreview(doc) {
  const html = renderDoc(doc).replace(/<a(\s[^>]*)?>/g, '<span$1>').replace(/<\/a>/g, '</span>');
  return `<div class="page-fit mini">${html}</div>`;
}
