// Letter-body formatting helpers.
// The body is stored as plain text with light markup: "**bold**" and lines starting with "# " for bold sub-headings.
// These helpers convert to that markup from pasted HTML and from the in-page editor, and power the Bold / Heading controls.

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'UL', 'OL', 'TABLE', 'TR', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'META', 'TITLE', 'XML']);

function boldOf(el, inherited) {
  const w = el.style?.fontWeight;
  if (w) return w === 'bold' || w === 'bolder' || parseInt(w, 10) >= 600; // Google Docs wraps all in <b style="font-weight:normal">
  if (el.tagName === 'B' || el.tagName === 'STRONG') return true;
  return inherited;
}

/** Walk a DOM tree into blocks of text runs: [{ parts: [{t, bold}], heading }]. */
function collectBlocks(rootNode) {
  const blocks = [];
  let cur = null;
  const open = () => { if (!cur) { cur = { parts: [], heading: false }; blocks.push(cur); } return cur; };
  const close = () => { cur = null; };
  const walk = (node, bold) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue.replace(/\s+/g, ' ');
      if (t.trim() || (cur && t)) open().parts.push({ t, bold });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return;
    const tag = node.tagName;
    if (tag === 'BR') { if (cur) cur.parts.push({ t: '\n', bold: false }); return; }
    const heading = /^H[1-6]$/.test(tag);
    const b = heading ? false : boldOf(node, bold);
    if (BLOCK.has(tag)) close();
    if (heading) open().heading = true;
    node.childNodes.forEach(c => walk(c, b));
    if (BLOCK.has(tag)) close();
  };
  rootNode.childNodes.forEach(c => walk(c, false));
  return blocks;
}

const tidy = s => s.replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').trim();

/** One block's text with bold runs wrapped in ** (surrounding spaces kept outside the markers). */
function blockMarkup(blk) {
  const runs = [];
  blk.parts.forEach(p => {
    const last = runs[runs.length - 1];
    if (last && last.bold === p.bold) last.t += p.t; else runs.push({ ...p });
  });
  return tidy(runs.map(r => {
    if (!r.bold || !r.t.trim()) return r.t;
    const lead = r.t.match(/^\s*/)[0], trail = r.t.match(/\s*$/)[0];
    return `${lead}**${r.t.trim()}**${trail}`;
  }).join(''));
}

/** Headings sit directly above their paragraph; other blocks are separated by a blank line. */
const joinBlocks = lines => lines.reduce((acc, line, i) => acc + (i === 0 ? '' : lines[i - 1].startsWith('# ') ? '\n' : '\n\n') + line, '');

/** Convert pasted HTML into body markup. Returns null when the HTML carries no bold or headings worth keeping. */
export function htmlToLetterText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const blocks = collectBlocks(doc.body);
  let found = false;
  const out = [];
  for (const blk of blocks) {
    const visible = blk.parts.filter(p => p.t.trim());
    if (!visible.length) continue;
    if (blk.heading || visible.some(p => p.bold)) found = true;
    const allBold = visible.every(p => p.bold);
    const plain = tidy(blk.parts.map(p => p.t).join(''));
    // A short, fully-bold paragraph reads as a sub-heading, like in a formatted cover letter.
    if (blk.heading || (allBold && plain.length <= 90 && !plain.includes('\n') && !/[.!?:]$/.test(plain))) out.push(`# ${plain}`);
    else out.push(blockMarkup(blk));
  }
  return found ? joinBlocks(out) : null;
}

/** Convert the in-page editor's DOM back to body markup (exact: no heading guessing). */
export function editableToLetterText(el) {
  const out = [];
  for (const blk of collectBlocks(el)) {
    if (!blk.parts.some(p => p.t.trim())) continue;
    out.push(blk.heading ? `# ${tidy(blk.parts.map(p => p.t).join('')).replace(/\n/g, ' ')}` : blockMarkup(blk));
  }
  return joinBlocks(out);
}

/** Replace the textarea selection and notify the editor. */
function replaceSelection(ta, text, selStart, selEnd) {
  ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
  if (selStart != null) ta.setSelectionRange(selStart, selEnd);
  ta.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Toggle **bold** around the textarea selection (or insert empty markers at the cursor). */
export function toggleBold(ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const sel = v.slice(s, e);
  ta.focus();
  if (v.slice(s - 2, s) === '**' && v.slice(e, e + 2) === '**') { // already bold: unwrap
    ta.setSelectionRange(s - 2, e + 2);
    replaceSelection(ta, sel, s - 2, e - 2);
  } else if (/^\*\*[\s\S]*\*\*$/.test(sel)) {
    replaceSelection(ta, sel.slice(2, -2), s, e - 4);
  } else {
    const lead = sel.match(/^\s*/)[0], trail = sel.match(/\s*$/)[0], core = sel.trim();
    replaceSelection(ta, `${lead}**${core}**${trail}`, s + lead.length + 2, s + lead.length + 2 + core.length);
  }
}

/** Toggle "# " sub-heading on every textarea line touched by the selection. */
export function toggleHeading(ta) {
  const { selectionStart: s, selectionEnd: e, value: v } = ta;
  const start = v.lastIndexOf('\n', s - 1) + 1;
  const endNl = v.indexOf('\n', e);
  const end = endNl === -1 ? v.length : endNl;
  const lines = v.slice(start, end).split('\n');
  const allHeadings = lines.every(l => /^#{1,3}\s/.test(l) || !l.trim());
  const next = lines.map(l => (!l.trim() ? l : allHeadings ? l.replace(/^#{1,3}\s+/, '') : `# ${l.replace(/^#{1,3}\s+/, '')}`)).join('\n');
  ta.focus();
  ta.setSelectionRange(start, end);
  replaceSelection(ta, next, start, start + next.length);
}

/** Bold / heading inside the in-page editor (contenteditable). */
export function editableBold(el) {
  el.focus();
  document.execCommand('bold');
}
export function editableHeading(el) {
  el.focus();
  const block = (document.queryCommandValue('formatBlock') || '').toLowerCase();
  document.execCommand('formatBlock', false, /^h[1-6]$/.test(block) ? 'p' : 'h4');
}

/**
 * Convert an in-page list or paragraph editor back to stored text: one line per block
 * (each bullet of a list), with bold runs wrapped in **.
 */
export function editableToLines(el) {
  return collectBlocks(el)
    .map(blk => blockMarkup(blk).replace(/\s*\n\s*/g, ' '))
    .filter(Boolean)
    .join('\n');
}
