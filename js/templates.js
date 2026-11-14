// Document templates. Each template renders a CV and a matching cover letter into an A4 ".page".
import { FONTS, splitLines, splitList, splitEntries, pageSize, pageScale, validPhoto, entryParts, languageLevel } from './data.js';

/** A4 page size in CSS pixels at 96 dpi (the default; see pageSize() for a document's own size). */
export const PAGE = Object.freeze({ W: 794, H: 1123 });

/**
 * layout: where the sections go.
 *   single     one column
 *   side-left  full-height sidebar on the left (name, contact, skills)
 *   side-right header on top, narrow column on the right
 *   profile    card header with the summary in it, shaded column on the right
 * header: which header is drawn. skills: how skills are shown in the main column.
 * sideEducation (profile layout): education goes in the right column instead of the main one.
 * Optional: labels (section titles shown instead of the default ones), levels: false (no language
 * level bars), pageNumbers ("Page 1 of 2" footers), dateSep (between start and end dates).
 */
export const TEMPLATES = [
  { id: 'banner', name: 'Banner', layout: 'single', header: 'banner', skills: 'inline', tags: ['ats', 'single'], desc: 'Two-tone header band with an icon contact row. Letters get bold section sub-headings.' },
  { id: 'profile', name: 'Profile', layout: 'profile', header: 'banner', skills: 'chips', tags: ['two-col', 'photo'], desc: 'Header card with your photo and summary, experience on the left, skill chips on the right.' },
  {
    id: 'signature', name: 'Signature', layout: 'profile', header: 'stacked', skills: 'chips', sideEducation: true, levels: false, pageNumbers: true, dateSep: ' - ',
    labels: { Experience: 'Work experience', Certifications: 'Certificates' },
    tags: ['two-col', 'photo'], desc: 'Photo and name over a summary band, work experience with company notes, and a grey side panel for skills, certificates, languages, education, achievements and interests.',
  },
  { id: 'classic', name: 'Classic', layout: 'single', header: 'plain', skills: 'inline', tags: ['ats', 'single'], desc: 'Centered header, single column. Safest choice for applicant tracking systems.' },
  { id: 'minimal', name: 'Minimal', layout: 'single', header: 'plain', skills: 'inline', tags: ['ats', 'single'], desc: 'Quiet, left-aligned layout with hairline rules. Great for conservative industries.' },
  { id: 'executive', name: 'Executive', layout: 'single', header: 'plain', skills: 'inline', tags: ['ats', 'single'], desc: 'Bold color header band for senior and leadership roles.' },
  { id: 'tech', name: 'Tech', layout: 'single', header: 'plain', skills: 'chips', skillsFirst: true, tags: ['ats', 'single'], desc: 'Skills up front as chips — built for engineering and IT roles.' },
  { id: 'timeline', name: 'Timeline', layout: 'single', header: 'plain', skills: 'chips', tags: ['single', 'creative'], desc: 'Your career as a line of dated milestones, newest first.' },
  { id: 'elegant', name: 'Elegant', layout: 'single', header: 'plain', skills: 'inline', tags: ['ats', 'single'], desc: 'Centered, widely spaced capitals and fine rules. Suits law, finance and academia.' },
  { id: 'bold', name: 'Bold', layout: 'single', header: 'plain', skills: 'chips', tags: ['single', 'creative'], desc: 'A large name and solid heading bars for a confident first impression.' },
  { id: 'corporate', name: 'Corporate', layout: 'single', header: 'split', skills: 'inline', tags: ['ats', 'single'], desc: 'Name on the left, contact details on the right, tinted heading strips.' },
  { id: 'modern', name: 'Modern', layout: 'side-left', header: 'sidebar', skills: 'list', tags: ['two-col', 'creative', 'photo'], desc: 'Colored sidebar with contact, skills and languages.' },
  { id: 'studio', name: 'Studio', layout: 'side-left', header: 'sidebar', skills: 'list', tags: ['two-col', 'photo'], desc: 'Soft grey sidebar with your photo, and skill bars in your accent colour.' },
  { id: 'compact', name: 'Compact', layout: 'side-right', header: 'plain', skills: 'list', tags: ['two-col'], desc: 'Dense two-column layout that fits a lot on one page.' },
];
const templateOf = id => TEMPLATES.find(t => t.id === id) || TEMPLATES[0];

export const TEMPLATE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'ats', label: 'ATS-optimized' },
  { id: 'single', label: 'Single column' },
  { id: 'two-col', label: 'Two column' },
  { id: 'creative', label: 'Creative' },
  { id: 'photo', label: 'With photo' },
];

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fontCss = id => (FONTS.find(f => f.id === id) || FONTS[0]).css;
const dates = (a, b, sep = ' – ') => [a, b].filter(Boolean).map(esc).join(sep);

/**
 * Address a contact value opens, or '' when it is not one. Only mailto: and http(s) links are
 * produced, so a value such as "javascript:..." is never turned into a link.
 * @param {'email'|'website'|'linkedin'|'github'|string} kind
 */
export function contactUrl(kind, value) {
  const v = String(value ?? '').trim();
  if (!v || /\s/.test(v)) return '';
  if (kind === 'email') return /^[^@:/]+@[^@:/]+\.[^@:/]+$/.test(v) ? `mailto:${v}` : '';
  if (!['website', 'linkedin', 'github'].includes(kind)) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^[\w-]+(\.[\w-]+)+([/:?#].*)?$/.test(v)) return `https://${v}`; // "github.com/name"
  if (/^[\w-]+$/.test(v)) { // a bare handle
    if (kind === 'linkedin') return `https://www.linkedin.com/in/${v}`;
    if (kind === 'github') return `https://github.com/${v}`;
  }
  return '';
}

/** `shown` as a link that opens in a new tab, or as plain text when the value is not a link. */
function contactLink(kind, value, shown, cls = '') {
  const url = contactUrl(kind, value);
  const c = cls ? ` class="${cls}"` : '';
  return url
    ? `<a${c} href="${esc(url)}" target="_blank" rel="noopener noreferrer">${shown}</a>`
    : `<span${c}>${shown}</span>`;
}

const CONTACT_KINDS = ['email', 'phone', 'location', 'website', 'linkedin', 'github'];
function contactItems(p) {
  return CONTACT_KINDS.filter(k => p[k]).map(k => (contactUrl(k, p[k]) ? contactLink(k, p[k], esc(p[k])) : esc(p[k])));
}

// Small inline icons (stroke = currentColor) for the Banner contact row.
const ICONS = {
  email: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24"><rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/></svg>',
  location: '<svg viewBox="0 0 24 24"><path d="M3 6.5 8 4l5 2.5L18 4v6"/><path d="M3 6.5V20l5-2.5 3 1.5M8 4v13.5M13 6.5v4"/><path d="M17.5 21.5s-4-3.4-4-6.5a4 4 0 0 1 8 0c0 3.1-4 6.5-4 6.5z"/><circle cx="17.5" cy="15" r="1.3"/></svg>',
  website: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" class="fill"><path d="M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm3 7v8h2.5v-8H7zm1.25-4a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8zM11 10v8h2.5v-4.2c0-1.2.6-1.9 1.5-1.9s1.4.6 1.4 1.9V18H19v-4.8c0-2.4-1.3-3.4-3-3.4-1.2 0-2 .5-2.5 1.2V10H11z"/></svg>',
  github: '<svg viewBox="0 0 24 24" class="fill"><path d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.7c-2.8.6-3.4-1.3-3.4-1.3-.5-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .8.1-.7.4-1.1.6-1.3-2.2-.3-4.6-1.1-4.6-5a3.9 3.9 0 0 1 1-2.7c-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.4 9.4 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7a3.9 3.9 0 0 1 1 2.7c0 3.9-2.4 4.7-4.6 5 .4.3.7.9.7 1.9V21c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
};

/** Contact items with icons; LinkedIn/GitHub shown as handles like on a printed letterhead, linked to the profile. */
function iconContacts(p) {
  const handle = v => v.replace(/^https?:\/\//, '').replace(/^(www\.)?(linkedin\.com\/in|github\.com)\//i, '').replace(/\/$/, '');
  const shown = { linkedin: handle, github: handle };
  return CONTACT_KINDS.filter(k => p[k])
    .map(k => contactLink(k, p[k], `${ICONS[k]}<span>${esc((shown[k] || String)(p[k]))}</span>`, `b-ci${k === 'email' ? ' b-upper' : ''}`))
    .join('');
}

/** Escape text and allow **bold**. */
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

/** Letter body: blank line = new paragraph, a line starting with "# " = bold sub-heading. */
export function letterBlocks(body) {
  const out = [];
  let para = [];
  const flush = () => { if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`); para = []; };
  (body || '').split('\n').forEach(raw => {
    const line = raw.trim();
    if (!line) return flush();
    if (/^#{1,3}\s+/.test(line)) { flush(); out.push(`<h4 class="l-h">${inline(line.replace(/^#{1,3}\s+/, ''))}</h4>`); return; }
    para.push(line);
  });
  flush();
  return out.join('');
}

// Section icons for templates that show them (drawn for this app; stroke = currentColor).
const SECTION_ICONS = {
  Summary: '<path d="M5 6h14M5 12h14M5 18h9"/>',
  Experience: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>',
  Education: '<path d="m2 9 10-5 10 5-10 5z"/><path d="M6 11.5V16c2 2 10 2 12 0v-4.5"/>',
  Projects: '<path d="M4 6a2 2 0 0 1 2-2h4l2 3h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/>',
  Skills: '<path d="M15.5 3.5a4.5 4.5 0 0 0-4.3 5.9l-7.4 7.4a1.9 1.9 0 0 0 2.7 2.7l7.4-7.4a4.5 4.5 0 0 0 5.9-4.3l-2.7 2.7-2.6-.6-.6-2.6z"/><path d="m4 4 1.3 3.2 1.7.4 5.3 5.3M4 4l3.2 1.3.4 1.7M13.5 15.5l4.3 4.3a1.6 1.6 0 0 0 2.3-2.3l-4.3-4.3"/>',
  Languages: '<path d="M3 5.5h9M7.5 3v2.5M5 5.5c.8 2.7 2.8 5 5.5 6.3M10 5.5c-.8 3.5-3.1 6.4-6.5 7.7"/><path d="m12.5 21 4.2-9.5L21 21M14 17.5h5.5"/>',
  Certifications: '<path d="M14 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v4"/><path d="M14 3v5h5M8.5 9h3M8.5 12.5h5M8.5 16h3"/><circle cx="17.5" cy="16" r="2.7"/><path d="m16 18.3-.8 3.2 2.3-1.1 2.3 1.1-.8-3.2"/>',
  Contact: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  Achievements: '<circle cx="12" cy="9" r="6"/><circle cx="12" cy="9" r="3"/><path d="m8.4 13.8-2 7.2 5.6-3 5.6 3-2-7.2"/>',
  Interests: '<path d="M7 21h10M8.5 21l.8-5.2C7.6 15 6.5 13.5 6.5 11.7L10.5 6V3.5l2 1.8h.8c3.1 0 5.2 3 5.2 6.4V21"/><path d="M11 9.5h.01"/>',
};

/**
 * Editing helpers for the live preview. With `on`, text is wrapped in in-page editors and the page gets
 * add / move / remove / edit controls. Without it every helper returns plain output (or nothing), so
 * thumbnails and the PDF never contain an editor or a control.
 * Controls carry no text of their own (CSS draws their labels), so both renders hold the same words.
 *
 * The editable page takes the same space as the printed one, so the preview shows the PDF's pages:
 * controls float over the page, an empty optional line (class ed-opt) shows only while its entry is
 * being edited, and an empty section is not drawn (the editor offers it below the page instead).
 */
function editing(on) {
  if (!on) {
    return {
      on,
      f: (path, value) => esc(value),
      para: (path, value) => inline(value),
      bullets: (path, text) => {
        const lines = splitLines(text);
        return lines.length ? `<ul>${lines.map(b => `<li>${inline(b)}</li>`).join('')}</ul>` : '';
      },
      ctl: () => '', add: () => '', pencil: () => '',
    };
  }
  const box = label => `spellcheck="true" role="textbox" aria-label="${esc(label)}"`;
  const button = (cls, attrs, label) =>
    `<button type="button" class="${cls}" ${attrs} data-label="${esc(label)}" aria-label="${esc(label)}" title="${esc(label)}"></button>`;
  const move = (list, i, dir, off, cls, label) =>
    button(`ed-btn ${cls}`, `data-act="move" data-list="${list}" data-i="${i}" data-dir="${dir}"${off ? ' disabled' : ''}`, label);
  return {
    on,
    /** Single-line text, edited in place. */
    f: (path, value, label) =>
      `<span class="l-field" contenteditable="plaintext-only" ${box(label)} data-edit-field="${esc(path)}" data-placeholder="${esc(label)}">${esc(value)}</span>`,
    /** One paragraph that may contain bold text. */
    para: (path, value, label) =>
      `<span class="l-lines" contenteditable="true" ${box(label)} data-edit-lines="${esc(path)}" data-placeholder="${esc(label)}">${inline(value)}</span>`,
    /** A bullet list, one line of the stored text per bullet. Always drawn, so there is somewhere to type. */
    bullets: (path, text) => {
      const label = 'Achievements, one per line';
      return `<ul class="l-lines${splitLines(text).length ? '' : ' ed-opt'}" contenteditable="true" aria-multiline="true" ${box(label)} data-edit-lines="${esc(path)}" data-placeholder="${label}">${
        splitLines(text).map(b => `<li>${inline(b)}</li>`).join('') || '<li></li>'}</ul>`; // an empty bullet to type in
    },
    /** Move up / move down / remove, for item `i` of a list of `len`. */
    ctl: (list, i, len) => `<span class="ed-ctl" contenteditable="false">${
      move(list, i, -1, i === 0, 'ed-up', 'Move up')}${
      move(list, i, 1, i === len - 1, 'ed-down', 'Move down')}${
      button('ed-btn ed-remove', `data-act="remove-item" data-list="${list}" data-i="${i}"`, 'Remove')}</span>`,
    /** "+ Add ..." at the end of a list section. */
    add: (list, label) => button('ed-add', `data-act="add-item" data-list="${list}"`, label),
    /** Opens the details panel at a field, for content that is not typed on the page (contact, photo, skills). */
    pencil: (group, path, label) => button('ed-btn ed-pencil', `data-edit-open="${group}" data-edit-focus="${path}"`, label),
  };
}
const PLAIN = editing(false);

/**
 * @param {string} title
 * @param {string} inner the section's content; an empty section is not drawn
 * @param {{pencil?: string, after?: string}} [tools] editing controls (live preview only)
 */
function section(title, inner, { pencil = '', after = '', label = '' } = {}) {
  if (!inner && !after) return '';
  const icon = SECTION_ICONS[title] ? `<span class="r-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${SECTION_ICONS[title]}</svg></span>` : '';
  return `<section class="r-sec" data-sec="${title.toLowerCase()}"><h3 class="r-h">${icon}<span>${esc(label || title)}</span>${pencil}</h3><div class="r-body">${inner}${after}</div></section>`;
}
/** A section whose content is edited in the details panel: a pencil in its heading while editing. */
function panelSection(E, title, inner, group, path, label = '') {
  if (!E.on || !inner) return section(title, inner, { label });
  return section(title, inner, { label, pencil: E.pencil(group, path, `Edit ${(label || title).toLowerCase()}`) });
}
/** The entries of a list section followed by its "+ Add" control; nothing at all for an empty list. */
const withAdd = (items, E, list, label) => (items ? items + E.add(list, label) : '');
/** Class for an optional line: hidden while it is empty and its entry is not being edited. */
const opt = (E, value) => (E.on && !value ? ' ed-opt' : '');

/** Round profile photo, or '' when the document has none. Only embedded images are ever drawn. */
const photoHtml = p => (validPhoto(p.photo) ? `<img class="r-photo" src="${esc(p.photo)}" alt="">` : '');

/** "2019 – Present"; two fields while editing. */
const period = (E, at, e, sep = ' – ') => (E.on ? `${E.f(`${at}.start`, e.start, 'Start')}${esc(sep)}${E.f(`${at}.end`, e.end, 'End')}` : dates(e.start, e.end, sep));

function experienceHtml(r, E, sep) {
  const n = r.experience.length;
  const items = r.experience
    .map((e, i) => {
      const at = `experience.${i}`;
      return `<div class="r-item">${E.ctl('experience', i, n)}
        <div class="r-row"><strong>${E.on ? E.f(`${at}.role`, e.role, 'Job title') : esc(e.role) || 'Role'}</strong><span class="r-date">${period(E, at, e, sep)}</span></div>
        <div class="r-row r-sub"><span>${E.f(`${at}.company`, e.company, 'Company')}</span><span>${E.f(`${at}.location`, e.location, 'Location')}</span></div>
        ${e.about || E.on ? `<p class="r-about${opt(E, e.about)}">${E.f(`${at}.about`, e.about, 'About the company (optional)')}</p>` : ''}
        ${E.bullets(`${at}.bullets`, e.bullets)}
      </div>`;
    })
    .join('');
  return withAdd(items, E, 'experience', 'Add position');
}

function educationHtml(r, E, sep) {
  const n = r.education.length;
  const items = r.education
    .map((e, i) => {
      const at = `education.${i}`;
      return `<div class="r-item">${E.ctl('education', i, n)}
        <div class="r-row"><strong>${E.on ? E.f(`${at}.degree`, e.degree, 'Degree') : esc(e.degree) || 'Degree'}</strong><span class="r-date">${period(E, at, e, sep)}</span></div>
        <div class="r-row r-sub"><span>${E.f(`${at}.school`, e.school, 'School')}</span><span>${E.f(`${at}.location`, e.location, 'Location')}</span></div>
        ${e.details || E.on ? `<p class="r-p${opt(E, e.details)}">${E.f(`${at}.details`, e.details, 'Details (optional)')}</p>` : ''}
      </div>`;
    })
    .join('');
  return withAdd(items, E, 'education', 'Add education');
}

function projectsHtml(r, E) {
  const n = r.projects.length;
  const items = r.projects
    .map((p, i) => {
      const at = `projects.${i}`;
      return `<div class="r-item">${E.ctl('projects', i, n)}<div class="r-row"><strong>${E.f(`${at}.name`, p.name, 'Project name')}</strong><span class="r-date">${E.f(`${at}.link`, p.link, 'Link')}</span></div>
      ${p.description || E.on ? `<p class="r-p${opt(E, p.description)}">${E.f(`${at}.description`, p.description, 'What it is and what came of it')}</p>` : ''}</div>`;
    })
    .join('');
  return withAdd(items, E, 'projects', 'Add project');
}

function achievementsHtml(r, E) {
  const all = r.achievements || [];
  const items = all
    .map((a, i) => {
      if (!E.on && !a.title && !a.description) return ''; // an untouched entry is not printed
      const at = `achievements.${i}`;
      return `<div class="r-item">${E.ctl('achievements', i, all.length)}<div class="r-row"><strong>${E.f(`${at}.title`, a.title, 'Achievement')}</strong><span class="r-date">${E.f(`${at}.date`, a.date, 'Date')}</span></div>
      ${a.description || E.on ? `<p class="r-p${opt(E, a.description)}">${E.para(`${at}.description`, a.description, 'What you did and the result')}</p>` : ''}</div>`;
    })
    .join('');
  return withAdd(items, E, 'achievements', 'Add achievement');
}

const SUMMARY_HINT = 'Summary: who you are, your strongest results, what you want next';
const summaryHtml = (r, E) => (r.summary || E.on ? `<p class="r-p">${E.para('summary', r.summary, SUMMARY_HINT)}</p>` : '');
const skillsInline = r => (splitList(r.skills).length ? `<p class="r-p">${splitList(r.skills).map(esc).join(' · ')}</p>` : '');
const skillsChips = r => (splitList(r.skills).length ? `<div class="r-chips">${splitList(r.skills).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : '');
const skillsList = r => (splitList(r.skills).length ? `<ul class="r-plain">${splitList(r.skills).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '');
const textBlock = t => (t ? `<p class="r-p">${esc(t)}</p>` : '');

// Small icons for common interests; anything else gets a plain mark. Drawn for this app.
const INTEREST_ICONS = [
  [/fitness|gym|strength|weight|workout|lifting/i, '<path d="M6.5 7v10M3.5 9.5v5M17.5 7v10M20.5 9.5v5M6.5 12h11"/>'],
  [/\bai\b|llm|machine learning|tech|computer|coding|programming|electronics/i, '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3M9.5 14.5l1.5-5 1.5 5M10 13h2M14.5 9.5v5"/>'],
  [/read|book|literature|writing/i, '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H12v16H6.5A2.5 2.5 0 0 0 4 21.5zM20 5.5A2.5 2.5 0 0 0 17.5 3H12v16h5.5a2.5 2.5 0 0 1 2.5 2.5z"/>'],
  [/music|guitar|piano|sing/i, '<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'],
  [/travel|trip|hiking|explor/i, '<path d="M21 15.5 13 11V4.5a1.5 1.5 0 0 0-3 0V11l-8 4.5V17l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-4.5l8 2.5z"/>'],
  [/run|cycling|swim|sport|football|cricket|tennis|yoga/i, '<circle cx="14" cy="4.5" r="1.8"/><path d="m6 21 3.5-5 3 2.5L14 13l3.5 3H21M9.5 9l3.5-1.5 2 3.5"/>'],
  [/photo|camera|film/i, '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'],
  [/cook|food|baking|chef/i, '<path d="M6 13a5 5 0 0 1 .5-10 5 5 0 0 1 11 0A5 5 0 0 1 18 13v8H6zM6 17h12"/>'],
  [/chess|board game|puzzle/i, '<path d="M8 21h9M9 21l1-6c-2-.6-3.5-2.4-3.5-4.6L10 5l1.5-2 1 2H14c2.5 0 4.5 2.5 4.5 5.5V21"/>'],
];
const INTEREST_DEFAULT = '<circle cx="12" cy="12" r="3.5"/>';
function interestsList(text) {
  const items = splitList(text);
  if (!items.length) return '';
  const icon = s => (INTEREST_ICONS.find(([re]) => re.test(s)) || [null, INTEREST_DEFAULT])[1];
  return `<ul class="r-plain r-interests">${items.map(s => `<li><span class="r-int-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${icon(s)}</svg></span><span>${esc(s)}</span></li>`).join('')}</ul>`;
}

/** Five dots for a language level (1-5); drawn only by templates that style .r-level. */
const levelDots = level => (level
  ? `<span class="r-level" role="img" aria-label="Level ${level} of 5">${[1, 2, 3, 4, 5].map(i => `<i${i <= level ? ' class="on"' : ''}></i>`).join('')}</span>`
  : '');
/** Certifications or languages, one per line, each "Title | Detail | Date" (see entryParts). */
function entriesInline(text) {
  const items = splitEntries(text).map(entryParts).filter(e => e.title);
  return items.length ? `<p class="r-p">${items.map(e => esc([e.title, e.detail, e.date].filter(Boolean).join(' – '))).join(' · ')}</p>` : '';
}
function entriesList(text, { levels = false } = {}) {
  const items = splitEntries(text).map(entryParts).filter(e => e.title);
  if (!items.length) return '';
  return `<ul class="r-plain r-entries">${items.map(e => `<li><span class="r-e-t">${esc(e.title)}</span>${
    e.detail ? `<span class="r-e-s">${esc(e.detail)}</span>` : ''}${
    e.date ? `<span class="r-e-d">${esc(e.date)}</span>` : ''}${levels ? levelDots(languageLevel(e.detail)) : ''}</li>`).join('')}</ul>`;
}

/**
 * @param {object} p personal details
 * @param {'plain'|'split'|'sidebar'|'banner'} variant
 * @param {object} E editing helpers
 * @param {string} [summary] shown inside the banner header (Profile and Signature templates)
 */
function header(p, variant, E, summary) {
  const name = E.on ? E.f('personal.name', p.name, 'Your Name') : esc(p.name) || 'Your Name';
  const title = p.title || E.on ? `<div class="r-title">${E.f('personal.title', p.title, 'Headline / job title')}</div>` : '';
  const photo = photoHtml(p);
  const contacts = contactItems(p);
  // Contact details and the photo are edited in the details panel.
  const pencil = E.pencil('personal', 'personal.email', 'Edit contact details and photo');
  if (variant === 'sidebar') return `${photo}<div class="r-name">${name}</div>${title}${pencil}`;
  if (variant === 'banner') {
    const ci = iconContacts(p);
    const about = summary !== undefined && (summary || E.on) ? `<p class="b-summary">${E.para('summary', summary, SUMMARY_HINT)}</p>` : '';
    return `<header class="b-head${photo ? ' has-photo' : ''}">
      <div class="b-top">${photo}<div class="b-id"><div class="r-name">${name}</div>${title}${about}</div></div>
      ${ci || E.on ? `<div class="b-contact">${ci}${pencil}</div>` : ''}
    </header>`;
  }
  if (variant === 'stacked') {
    const ci = iconContacts(p);
    const about = summary || E.on ? `<p class="b-summary">${E.para('summary', summary, SUMMARY_HINT)}</p>` : '';
    return `<header class="s-head${photo ? ' has-photo' : ''}">${photo}
      <div class="s-id"><div class="r-name">${name}</div>${title}</div>
      <div class="s-band">${about}</div>
      ${ci || E.on ? `<div class="b-contact">${ci}${pencil}</div>` : ''}
    </header>`;
  }
  const contactRow = contacts.length || E.on ? `<div class="r-contact">${contacts.map(c => `<span>${c}</span>`).join('')}${pencil}</div>` : '';
  if (variant === 'split') {
    return `<header class="r-header r-split">${photo}<div class="r-id"><div class="r-name">${name}</div>${title}</div>${contactRow}</header>`;
  }
  return `<header class="r-header${photo ? ' has-photo' : ''}">${photo}<div class="r-id"><div class="r-name">${name}</div>${title}${contactRow}</div></header>`;
}

function pageWrap(doc, inner) {
  const size = pageSize(doc);
  const scale = pageScale(doc);
  const style = `--accent:${esc(doc.theme.color)};--font:${fontCss(doc.theme.font)};--pw:${size.W}px;--ph:${size.H}px;--sp:${scale.spacing};--mg:${scale.margin}`;
  const numbered = templateOf(doc.templateId).pageNumbers ? ' data-page-numbers' : '';
  return `<div class="page tpl-${esc(doc.templateId)}"${numbered} style="${style}">${inner}</div>`;
}

/**
 * @param {object} r CV
 * @param {{editable?: boolean}} [opts] editable: text is edited in place and the page shows controls
 *   (live preview only, never thumbnails or PDF)
 */
export function renderResume(r, opts = {}) {
  const E = opts.editable ? editing(true) : PLAIN;
  const t = templateOf(r.templateId);
  const label = title => t.labels?.[title] || '';
  const sec = (title, inner) => section(title, inner, { label: label(title) });
  const summary = sec('Summary', summaryHtml(r, E));
  const experience = sec('Experience', experienceHtml(r, E, t.dateSep));
  const education = sec('Education', educationHtml(r, E, t.dateSep));
  const projects = sec('Projects', projectsHtml(r, E));
  const achievements = sec('Achievements', achievementsHtml(r, E));
  const panel = (title, inner, group, path) => panelSection(E, title, inner, group, path, label(title));

  if (t.layout === 'side-left' || t.layout === 'side-right') {
    const contacts = contactItems(r.personal);
    const contactSec = contacts.length ? section('Contact', `<ul class="r-plain">${contacts.map(c => `<li>${c}</li>`).join('')}</ul>`) : '';
    const sideRest = [
      panel('Skills', skillsList(r), 'skills', 'skills'),
      panel('Languages', entriesList(r.languages), 'extra', 'languages'),
      panel('Certifications', entriesList(r.certifications), 'extra', 'certifications'),
      panel('Interests', interestsList(r.interests), 'interests', 'interests'),
    ].join('');
    const main = `<main class="r-main">${summary}${experience}${education}${projects}${achievements}</main>`;
    if (t.layout === 'side-left') {
      return pageWrap(r, `<div class="r-cols"><aside class="r-side">${header(r.personal, 'sidebar', E)}${contactSec}${sideRest}</aside>${main}</div>`);
    }
    return pageWrap(r, `${header(r.personal, t.header, E)}<div class="r-cols">${main}<aside class="r-side">${sideRest}</aside></div>`);
  }

  if (t.layout === 'profile') {
    const side = [
      panel('Skills', skillsChips(r), 'skills', 'skills'),
      panel('Certifications', entriesList(r.certifications), 'extra', 'certifications'),
      panel('Languages', entriesList(r.languages, { levels: t.levels !== false }), 'extra', 'languages'),
      t.sideEducation ? education : '',
      achievements,
      panel('Interests', interestsList(r.interests), 'interests', 'interests'),
    ].join('');
    const main = `${experience}${t.sideEducation ? '' : education}${projects}`;
    return pageWrap(r, `${header(r.personal, t.header, E, r.summary)}<div class="b-body p-cols"><main class="r-main">${main}</main>${side ? `<aside class="r-side">${side}</aside>` : ''}</div>`);
  }

  const skills = panel('Skills', t.skills === 'chips' ? skillsChips(r) : skillsInline(r), 'skills', 'skills');
  const extras = [
    panel('Certifications', entriesInline(r.certifications), 'extra', 'certifications'),
    panel('Languages', entriesInline(r.languages), 'extra', 'languages'),
    achievements,
    panel('Interests', textBlock(splitList(r.interests).join(' · ')), 'interests', 'interests'),
  ];
  const order = t.skillsFirst
    ? [summary, skills, experience, projects, education, ...extras]
    : [summary, experience, education, skills, projects, ...extras];
  if (t.header === 'banner') return pageWrap(r, header(r.personal, 'banner', E) + `<div class="b-body">${order.join('')}</div>`);
  return pageWrap(r, header(r.personal, t.header, E) + order.join(''));
}

/**
 * @param {object} l letter
 * @param {{editable?: boolean}} [opts] editable: render the body as an in-page editor (live preview only, never print/PDF)
 */
export function renderLetter(l, opts = {}) {
  const t = templateOf(l.templateId);
  const rec = l.recipient;
  const recipientLines = [rec.name, rec.title, rec.company, rec.address].filter(Boolean).map(esc);
  const blocks = opts.editable
    ? `<div class="l-edit" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Letter body" data-edit="body" data-placeholder="Click here and write your letter…">${letterBlocks(l.body)}</div>`
    : letterBlocks(l.body) || '<p class="l-placeholder">Your letter will appear here…</p>';
  // In the live preview, single-line fields are editable in place; elsewhere E.f() returns the plain text.
  const E = opts.editable ? editing(true) : PLAIN;
  const ef = E.f;
  // "To" and the closing are always printed; empty fields fall back to sensible defaults.
  let toLines;
  if (opts.editable) {
    const nameShown = rec.name || (recipientLines.length ? '' : 'Hiring Manager');
    toLines = [ef('recipient.name', nameShown, 'Recipient name'),
      ...['title', 'company', 'address'].filter(k => rec[k]).map(k => ef(`recipient.${k}`, rec[k], `Recipient ${k}`))];
  } else {
    toLines = recipientLines.length ? recipientLines : ['Hiring Manager'];
  }
  const closing = ef('closing', l.closing?.trim() || 'Sincerely,', 'Closing');
  const signer = esc(l.personal.name) || 'Your Name';
  const greeting = ef('greeting', l.greeting?.trim() || 'Dear Hiring Manager,', 'Greeting');
  const date = ef('date', l.date, 'Date');
  if (t.header === 'banner') {
    return pageWrap(l, `${header(l.personal, 'banner', E)}<div class="b-body l-banner">
      <div class="b-to">
        <div class="b-label">To</div><div class="b-rec">${toLines.join('<br>')}</div>
        <div class="b-rule"></div>
        <div class="b-date">${date}</div>
      </div>
      <div class="b-divider"></div>
      <p>${greeting}</p>
      ${blocks}
      <div class="b-divider end"></div>
      <div class="b-close"><em>${closing}</em><br>${signer}</div>
    </div>`);
  }
  const body = `<div class="l-body">
    <p class="l-date">${date}</p>
    <p class="l-to"><span class="l-label">To</span><br>${toLines.join('<br>')}</p>
    ${l.job.role ? `<p class="l-subject"><strong>Re: ${esc(l.job.role)}</strong></p>` : ''}
    <p>${greeting}</p>
    ${blocks}
    <p class="l-close">${closing}<br><span class="l-sign">${signer}</span></p>
  </div>`;
  if (t.layout === 'side-left') {
    const contacts = contactItems(l.personal);
    return pageWrap(l, `<div class="r-cols"><aside class="r-side">${header(l.personal, 'sidebar', E)}${
      contacts.length ? section('Contact', `<ul class="r-plain">${contacts.map(c => `<li>${c}</li>`).join('')}</ul>`) : ''
    }</aside><main class="r-main">${body}</main></div>`);
  }
  return pageWrap(l, header(l.personal, t.header, E) + body);
}

export const renderDoc = (d, opts) => (d.type === 'cover' ? renderLetter(d, opts) : renderResume(d, opts));
