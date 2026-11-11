// Page previews: every preview is a real A4 ".page" scaled down with a CSS transform to fit its box.
import { renderDoc, PAGE } from './templates.js';
import { $, $$ } from './ui.js';

/** Scale every .page inside `root` to fit its container width. */
export function fitPages(root = document) {
  $$('.page-fit', root).forEach(box => {
    const page = $('.page', box);
    if (!page) return;
    const scale = Math.min(1, box.clientWidth / PAGE.W);
    page.style.transform = `scale(${scale})`;
    box.style.height = `${Math.max(page.scrollHeight, PAGE.H) * scale}px`;
  });
}
/** Re-fits previews when their container resizes. Views observe their own boxes. */
export const pageObserver = new ResizeObserver(() => fitPages());
window.addEventListener('resize', () => fitPages());

export function miniPreview(doc) {
  return `<div class="page-fit mini">${renderDoc(doc)}</div>`;
}
