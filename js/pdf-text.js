// Real text in the PDF. Every word of the rendered page is written in the document's own font, at the
// position, size, weight, colour and slant it has on screen. Compared with a picture of the page, the
// text stays sharp at any zoom, the file is much smaller, and copying, searching and applicant tracking
// systems read it as ordinary text, in reading order (header, main column, then side column).
//
// The page picture underneath is still taken (backgrounds, bands, chips, icons, photo), but with all
// text made transparent, so nothing is drawn twice.

/** Fonts the PDF can embed (OFL-licensed files in /fonts): CSS family, lower case → file per weight. */
export const EMBEDDED_FONTS = Object.freeze({
  hind: { dir: 'fonts/hind', weights: { 300: 'Hind-Light', 400: 'Hind-Regular', 500: 'Hind-Medium', 600: 'Hind-SemiBold', 700: 'Hind-Bold' } },
});

/** Synthetic italic: the slant browsers use for fonts without an italic (about 12 degrees). */
const SLANT = 0.21;

const familyOf = el => getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim().toLowerCase();
const nearest = (weights, w) => Object.keys(weights).map(Number).sort((a, b) => Math.abs(a - w) - Math.abs(b - w) || b - a)[0];

/** Text nodes that are drawn on the page: not empty, not inside an SVG icon. */
function textNodes(page) {
  const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.trim() && !n.parentElement.closest('svg') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
  return nodes;
}

/** True when every piece of text on the page uses a font the PDF can embed. */
export function canWriteText(page) {
  return textNodes(page).every(n => Object.hasOwn(EMBEDDED_FONTS, familyOf(n.parentElement)));
}

/**
 * Marks drawn by CSS (::before / ::after with text, such as a "|" separator or a "// " prefix) are
 * decoration, not content: they stay in the page picture and are not written as text, so an applicant
 * tracking system never reads them as part of a name or a heading. Their colour is recorded here so
 * the picture keeps them when the real text around them is made transparent (see PSEUDO_COLOURS).
 */
export function keepDecorations(page) {
  for (const el of page.querySelectorAll('*')) {
    if (el.closest('svg')) continue;
    for (const which of ['before', 'after']) {
      const cs = getComputedStyle(el, `::${which}`);
      if (!/^"[\s\S]*\S[\s\S]*"$/.test(cs.content)) continue;
      el.style.setProperty(`--pdf-${which}`, cs.color);
      el.classList.add(`pdf-k${which[0]}`);
    }
  }
  // Widely letter-spaced text also stays in the picture (see isWide); writeText adds it invisibly.
  for (const node of textNodes(page)) {
    const el = node.parentElement;
    if (!isWide(el)) continue;
    el.style.setProperty('--pdf-colour', getComputedStyle(el).color);
    el.classList.add('pdf-pic');
  }
}
/** CSS for the page picture: decorations and wide-spaced text keep the colour keepDecorations() recorded. */
export const PSEUDO_COLOURS = '.pdf-vector .pdf-kb::before { color: var(--pdf-before) !important; }'
  + ' .pdf-vector .pdf-ka::after { color: var(--pdf-after) !important; }'
  + ' .pdf-vector .pdf-pic { color: var(--pdf-colour) !important; }';

/**
 * Text with wide letter spacing ("S U M M A R Y" style headings). Written letter by letter apart, it
 * would reach an applicant tracking system as single letters; so it is kept in the page picture and
 * written once more as invisible text with normal spacing, which reads as words.
 */
const isWide = el => {
  const cs = getComputedStyle(el);
  return (parseFloat(cs.letterSpacing) || 0) / (parseFloat(cs.fontSize) || 1) > 0.1;
};

const fontCache = new Map(); // file name → base64 data
async function fontData(file) {
  if (!fontCache.has(file)) {
    const res = await fetch(new URL(`${file}.ttf`, document.baseURI));
    if (!res.ok) throw new Error(`could not load the font ${file}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    fontCache.set(file, btoa(bin));
  }
  return fontCache.get(file);
}

/**
 * Embed the font files the page needs. Only the characters actually used end up in the PDF.
 * @returns {(el: Element) => string} the jsPDF font name for an element's text
 */
export async function loadFonts(pdf, page) {
  const fontFor = el => {
    const { dir, weights } = EMBEDDED_FONTS[familyOf(el)];
    return `${dir}/${weights[nearest(weights, Number(getComputedStyle(el).fontWeight) || 400)]}`;
  };
  const files = new Set(textNodes(page).map(n => fontFor(n.parentElement)));
  for (const file of files) {
    pdf.addFileToVFS(`${file}.ttf`, await fontData(file));
    pdf.addFont(`${file}.ttf`, file, 'normal', 'Identity-H');
  }
  return fontFor;
}

/** A character the font cannot draw is replaced by a close one, or left out. */
const FALLBACK = { '✓': '-', '✔': '-', '→': '->', '▪': '-', '●': '•', ' ': ' ' };
function drawable(pdf, text) {
  const meta = pdf.getFont().metadata;
  if (!meta?.characterToGlyph) return text;
  let out = '';
  for (const ch of text) {
    if (meta.characterToGlyph(ch.codePointAt(0))) { out += ch; continue; }
    const alt = FALLBACK[ch];
    if (alt && [...alt].every(c => meta.characterToGlyph(c.codePointAt(0)))) out += alt;
  }
  return out;
}

const rgba = c => {
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] } : { r: 0, g: 0, b: 0, a: 1 };
};
/** Opacity of an element including its ancestors on the page. */
function opacityOf(el, page) {
  let o = 1;
  for (let e = el; e && e !== page.parentElement; e = e.parentElement) o *= Number(getComputedStyle(e).opacity) || 1;
  return o;
}

/**
 * Write every word of the page as text.
 * @param {(y: number) => number} place selects the PDF page a baseline (CSS px from the top) falls on
 *   and returns the baseline's position on that page
 */
export function writeText(pdf, page, fontFor, place, ptPerPx) {
  const origin = page.getBoundingClientRect();
  const range = document.createRange();
  const nodes = textNodes(page);
  const bulleted = new Set();
  /** Where a text node's first character is, to tell "Python" + "." (one word) from two words. */
  const startOf = node => {
    const i = node.nodeValue.search(/\S/);
    if (i < 0) return null;
    const probe = document.createRange();
    probe.setStart(node, i);
    probe.setEnd(node, i + 1);
    return { lead: i > 0, rect: probe.getBoundingClientRect() };
  };
  const pageHpt = pdf.internal.pageSize.getHeight();
  let gstate = 1;
  const setOpacity = o => {
    if (o === gstate) return;
    pdf.setGState(new pdf.GState({ opacity: o, 'stroke-opacity': o }));
    gstate = o;
  };
  nodes.forEach((node, index) => {
    const el = node.parentElement;
    const cs = getComputedStyle(el);
    const color = rgba(cs.color);
    const opacity = color.a * opacityOf(el, page);
    if (opacity < 0.02) return;
    // The first text of a list item: its bullet first, as a real "•" in the bullet's own colour and
    // size, where the browser draws it (the page picture leaves bullets out). The text reads as a list.
    const li = el.closest('li');
    if (li && !bulleted.has(li)) {
      bulleted.add(li);
      const b = bulletOf(li, origin);
      if (b) {
        pdf.setFont(fontFor(li), 'normal');
        pdf.setFontSize(b.size * ptPerPx);
        pdf.setTextColor(b.color.r, b.color.g, b.color.b);
        const lm = pdf.getFont().metadata;
        const la = Math.abs(lm?.ascender || 1055), ld = Math.abs(lm?.decender || 546);
        const x = b.content * ptPerPx - pdf.getTextWidth('• ');
        // A browser centres its disc a little lower than the font's "•"; follow the browser.
        const y = (place(b.top + b.height * (la / (la + ld))) + b.size * 0.1) * ptPerPx;
        pdf.text('• ', x, y, { charSpace: 0, horizontalScale: 1 });
      }
    }
    pdf.setFont(fontFor(el), 'normal');
    const sizePx = parseFloat(cs.fontSize);
    pdf.setFontSize(sizePx * ptPerPx);
    pdf.setTextColor(color.r, color.g, color.b);
    setOpacity(Math.round(opacity * 100) / 100);
    const meta = pdf.getFont().metadata;
    const asc = Math.abs(meta?.ascender || 1055), desc = Math.abs(meta?.decender || 546);
    // Wide-spaced text is in the page picture already: write it invisibly, with normal spacing.
    const wide = isWide(el);
    const charSpace = wide ? 0 : (parseFloat(cs.letterSpacing) || 0) * ptPerPx;
    const italic = /italic|oblique/.test(cs.fontStyle);
    const transform = cs.textTransform;
    const write = (text, r, space) => {
      let word = transform === 'uppercase' ? text.toUpperCase() : transform === 'lowercase' ? text.toLowerCase() : text;
      word = drawable(pdf, word);
      if (!word) return;
      // The line box of the text is the font's ascent plus descent; the baseline divides it in that ratio.
      const baseline = place(r.top - origin.top + r.height * (asc / (asc + desc)));
      const x = (r.left - origin.left) * ptPerPx;
      const y = baseline * ptPerPx;
      const natural = pdf.getTextWidth(word) + charSpace * Math.max(0, [...word].length - 1);
      const fit = (r.width * ptPerPx - (charSpace > 0 ? charSpace : 0)) / natural;
      const scale = !natural ? 1 : wide ? Math.min(3, Math.max(0.3, fit)) : Math.min(1.15, Math.max(0.87, fit));
      const options = { charSpace, horizontalScale: scale, ...(wide ? { renderingMode: 'invisible' } : {}) };
      if (italic) {
        // A slant matrix also moves the text by slant × its height above the page bottom; undo that.
        options.angle = new pdf.Matrix(1, 0, SLANT, 1, 0, 0);
        pdf.text(word + space, x - SLANT * (pageHpt - y), y, options);
      } else {
        pdf.text(word + space, x, y, options);
      }
    };
    const words = [...node.nodeValue.matchAll(/\S+/g)];
    words.forEach((m, k) => {
      range.setStart(node, m.index);
      range.setEnd(node, m.index + m[0].length);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // A space after the word only where the text has one: inside the node, or before the next node
      // unless that one continues the same word on the same line ("**Python**." is one word).
      let space = ' ';
      if (k === words.length - 1 && !/\s$/.test(node.nodeValue)) {
        const next = nodes[index + 1] && startOf(nodes[index + 1]);
        if (next && !next.lead && Math.abs(next.rect.top - r.top) < 2 && next.rect.left - r.right < parseFloat(cs.fontSize) * 0.15) space = '';
      }
      const rects = [...range.getClientRects()].filter(x => x.width);
      if (rects.length < 2) { write(m[0], r, space); return; }
      // The browser broke the word over two lines (after a hyphen): write each line's part in its place.
      const parts = [];
      for (let i = 0; i < m[0].length; i++) {
        range.setStart(node, m.index + i);
        range.setEnd(node, m.index + i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        if (!parts.length || Math.abs(parts[parts.length - 1].top - top) > 2) parts.push({ top, from: i, to: i + 1 });
        else parts[parts.length - 1].to = i + 1;
      }
      parts.forEach((part, j) => {
        range.setStart(node, m.index + part.from);
        range.setEnd(node, m.index + part.to);
        write(m[0].slice(part.from, part.to), range.getBoundingClientRect(), j === parts.length - 1 ? space : '');
      });
    });
  });
  setOpacity(1);
}

/**
 * The disc bullet of a list item: its colour and size (from ::marker), the left edge of the item's
 * text and its first line (CSS px from the page's top left). Null when the item has no disc bullet.
 */
function bulletOf(li, origin) {
  const cs = getComputedStyle(li);
  if (cs.listStyleType !== 'disc' || cs.display !== 'list-item') return null;
  const range = document.createRange();
  range.selectNodeContents(li);
  const line = range.getClientRects()[0];
  if (!line) return null;
  const mk = getComputedStyle(li, '::marker');
  return {
    content: li.getBoundingClientRect().left - origin.left + (parseFloat(cs.paddingLeft) || 0),
    top: line.top - origin.top,
    height: line.height,
    size: parseFloat(mk.fontSize) || parseFloat(cs.fontSize),
    color: rgba(mk.color || cs.color),
  };
}

// ---------- sharp graphics: photo rings, round icon backgrounds, icons ----------
// In the page picture these are bitmaps (soft at high zoom). With real text they are drawn here
// instead, and left out of the picture (see GRAPHICS_OFF): circles as vector shapes, the photo from
// its own image, each icon rendered on its own at high resolution.

/** CSS for the page picture: photos, icons and round icon backgrounds are drawn by drawGraphics. */
export const GRAPHICS_OFF = ' .pdf-vector .r-photo, .pdf-vector svg { visibility: hidden !important; }'
  + ' .pdf-vector .r-ico { background: transparent !important; }';

/** Pixels per CSS pixel for icons rendered on their own. */
const ICON_SCALE = 6;

const boxOf = (el, origin) => {
  const r = el.getBoundingClientRect();
  return { x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height };
};

/**
 * A filled circle (CSS px from the page's top left). The page is chosen first: a fill colour is
 * written into the current page, so setting it before switching pages would colour the wrong page.
 */
function disc(pdf, place, ptPerPx, cx, cy, radius, color) {
  const y = place(cy) * ptPerPx;
  pdf.setFillColor(color.r, color.g, color.b);
  pdf.circle(cx * ptPerPx, y, radius * ptPerPx, 'F');
}

/** Start a circular clipping area (PDF operators: four Bézier arcs, then "W n"); end it with "Q". */
function clipCircle(pdf, cx, cy, r) {
  const y = pdf.internal.pageSize.getHeight() - cy, c = r * 0.5523, n = v => v.toFixed(2);
  pdf.internal.write([
    'q', `${n(cx + r)} ${n(y)} m`,
    `${n(cx + r)} ${n(y + c)} ${n(cx + c)} ${n(y + r)} ${n(cx)} ${n(y + r)} c`,
    `${n(cx - c)} ${n(y + r)} ${n(cx - r)} ${n(y + c)} ${n(cx - r)} ${n(y)} c`,
    `${n(cx - r)} ${n(y - c)} ${n(cx - c)} ${n(y - r)} ${n(cx)} ${n(y - r)} c`,
    `${n(cx + c)} ${n(y - r)} ${n(cx + r)} ${n(y - c)} ${n(cx + r)} ${n(y)} c`,
    'W n',
  ].join('\n'));
}

/** The photo's own image as a JPEG data URL, cropped to the square the page shows (object-fit: cover). */
function photoJpeg(img) {
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, side, side);
  ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, side, side);
  return canvas.toDataURL('image/jpeg', 0.92);
}

/** A copy of an SVG icon with its CSS (colours, stroke) written onto it, so it renders on its own. */
function standaloneSvg(svg, w, h) {
  const copy = svg.cloneNode(true);
  const props = ['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity'];
  const sources = [svg, ...svg.querySelectorAll('*')];
  [copy, ...copy.querySelectorAll('*')].forEach((el, i) => {
    const cs = getComputedStyle(sources[i]);
    props.forEach(p => el.setAttribute(p, cs.getPropertyValue(p)));
    el.removeAttribute('class');
    el.removeAttribute('style');
  });
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('width', String(Math.round(w * ICON_SCALE)));
  copy.setAttribute('height', String(Math.round(h * ICON_SCALE)));
  return new XMLSerializer().serializeToString(copy);
}

/** Render SVG markup to a PNG data URL. */
function svgToPng(markup, w, h) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * ICON_SCALE);
      canvas.height = Math.round(h * ICON_SCALE);
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    image.onerror = () => reject(new Error('an icon could not be drawn'));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/**
 * Draw the photo (with its rings), round icon backgrounds and icons. Runs after the page picture and
 * before the text, so text stays on top.
 */
export async function drawGraphics(pdf, page, place, ptPerPx) {
  const origin = page.getBoundingClientRect();

  // Photos: the outer ring (border colour), the inner ring (background colour), then the photo
  // itself, clipped to the circle inside both rings.
  for (const img of page.querySelectorAll('img.r-photo')) {
    if (!img.complete || !img.naturalWidth) continue;
    const b = boxOf(img, origin);
    const cs = getComputedStyle(img);
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2, outer = b.w / 2;
    const border = parseFloat(cs.borderTopWidth) || 0, padding = parseFloat(cs.paddingTop) || 0;
    const borderColour = rgba(cs.borderTopColor), fill = rgba(cs.backgroundColor);
    if (border && borderColour.a > 0) disc(pdf, place, ptPerPx, cx, cy, outer, borderColour);
    if (padding && fill.a > 0) disc(pdf, place, ptPerPx, cx, cy, outer - border, fill);
    const inner = outer - border - padding;
    const y = place(cy) * ptPerPx;
    clipCircle(pdf, cx * ptPerPx, y, inner * ptPerPx);
    pdf.addImage(photoJpeg(img), 'JPEG', (cx - inner) * ptPerPx, y - inner * ptPerPx, inner * 2 * ptPerPx, inner * 2 * ptPerPx);
    pdf.internal.write('Q');
  }

  // Round icon backgrounds (the dark circles behind section icons).
  for (const ico of page.querySelectorAll('.r-ico')) {
    const cs = getComputedStyle(ico);
    const colour = rgba(cs.backgroundColor);
    if (colour.a === 0 || cs.display === 'none') continue;
    const b = boxOf(ico, origin);
    if (!b.w) continue;
    disc(pdf, place, ptPerPx, b.x + b.w / 2, b.y + b.h / 2, b.w / 2, colour);
  }

  // Icons, each rendered on its own at high resolution; identical icons are stored once.
  const rendered = new Map();
  for (const svg of page.querySelectorAll('svg')) {
    if (svg.parentElement.closest('svg') || getComputedStyle(svg).display === 'none') continue;
    const b = boxOf(svg, origin);
    if (!b.w || !b.h) continue;
    const markup = standaloneSvg(svg, b.w, b.h);
    if (!rendered.has(markup)) rendered.set(markup, { png: await svgToPng(markup, b.w, b.h), alias: `icon${rendered.size}` });
    const { png, alias } = rendered.get(markup);
    pdf.addImage(png, 'PNG', b.x * ptPerPx, place(b.y) * ptPerPx, b.w * ptPerPx, b.h * ptPerPx, alias);
  }
}
