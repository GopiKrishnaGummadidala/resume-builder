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
 */
export const TEMPLATES = [
  { id: 'banner', name: 'Banner', layout: 'single', header: 'banner', skills: 'inline', tags: ['ats', 'single'], desc: 'Two-tone header band with an icon contact row. Letters get bold section sub-headings.' },
  { id: 'profile', name: 'Profile', layout: 'profile', header: 'banner', skills: 'chips', tags: ['two-col', 'photo'], desc: 'Header card with your photo and summary, experience on the left, skill chips on the right.' },
  { id: 'signature', name: 'Signature', layout: 'profile', header: 'banner', skills: 'chips', sideEducation: true, tags: ['two-col', 'photo'], desc: 'The full picture: header card, career line with company notes, and cards for skills, certificates, language levels, achievements and interests.' },
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
const dates = (a, b) => [a, b].filter(Boolean).map(esc).join(' – ');

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
  location: '<svg viewBox="0 0 24 24"><path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
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
  Skills: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6-4.5-4.2 6.1-.7z"/>',
  Languages: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  Certifications: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 7 5-3 5 3-1.5-7"/>',
  Contact: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  Achievements: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8"/>',
  Interests: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
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
function section(title, inner, { pencil = '', after = '' } = {}) {
  if (!inner && !after) return '';
  const icon = SECTION_ICONS[title] ? `<span class="r-ico" aria-hidden="true"><svg viewBox="0 0 24 24">${SECTION_ICONS[title]}</svg></span>` : '';
  return `<section class="r-sec" data-sec="${title.toLowerCase()}"><h3 class="r-h">${icon}<span>${esc(title)}</span>${pencil}</h3><div class="r-body">${inner}${after}</div></section>`;
}
/** A section whose content is edited in the details panel: a pencil in its heading while editing. */
function panelSection(E, title, inner, group, path) {
  if (!E.on || !inner) return section(title, inner);
  return section(title, inner, { pencil: E.pencil(group, path, `Edit ${title.toLowerCase()}`) });
}
/** The entries of a list section followed by its "+ Add" control; nothing at all for an empty list. */
const withAdd = (items, E, list, label) => (items ? items + E.add(list, label) : '');
/** Class for an optional line: hidden while it is empty and its entry is not being edited. */
const opt = (E, value) => (E.on && !value ? ' ed-opt' : '');

/** Round profile photo, or '' when the document has none. Only embedded images are ever drawn. */
const photoHtml = p => (validPhoto(p.photo) ? `<img class="r-photo" src="${esc(p.photo)}" alt="">` : '');

/** "2019 – Present"; two fields while editing. */
const period = (E, at, e) => (E.on ? `${E.f(`${at}.start`, e.start, 'Start')} – ${E.f(`${at}.end`, e.end, 'End')}` : dates(e.start, e.end));

function experienceHtml(r, E) {
  const n = r.experience.length;
  const items = r.experience
    .map((e, i) => {
      const at = `experience.${i}`;
      return `<div class="r-item">${E.ctl('experience', i, n)}
        <div class="r-row"><strong>${E.on ? E.f(`${at}.role`, e.role, 'Job title') : esc(e.role) || 'Role'}</strong><span class="r-date">${period(E, at, e)}</span></div>
        <div class="r-row r-sub"><span>${E.f(`${at}.company`, e.company, 'Company')}</span><span>${E.f(`${at}.location`, e.location, 'Location')}</span></div>
        ${e.about || E.on ? `<p class="r-about${opt(E, e.about)}">${E.f(`${at}.about`, e.about, 'About the company (optional)')}</p>` : ''}
        ${E.bullets(`${at}.bullets`, e.bullets)}
      </div>`;
    })
    .join('');
  return withAdd(items, E, 'experience', 'Add position');
}

function educationHtml(r, E) {
  const n = r.education.length;
  const items = r.education
    .map((e, i) => {
      const at = `education.${i}`;
      return `<div class="r-item">${E.ctl('education', i, n)}
        <div class="r-row"><strong>${E.on ? E.f(`${at}.degree`, e.degree, 'Degree') : esc(e.degree) || 'Degree'}</strong><span class="r-date">${period(E, at, e)}</span></div>
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
const summaryHtml = (r, E) => (r.summary || E.on ? `<p class="r-p">${E.f('summary', r.summary, SUMMARY_HINT)}</p>` : '');
const skillsInline = r => (splitList(r.skills).length ? `<p class="r-p">${splitList(r.skills).map(esc).join(' · ')}</p>` : '');
const skillsChips = r => (splitList(r.skills).length ? `<div class="r-chips">${splitList(r.skills).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : '');
const skillsList = r => (splitList(r.skills).length ? `<ul class="r-plain">${splitList(r.skills).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '');
const textBlock = t => (t ? `<p class="r-p">${esc(t)}</p>` : '');
const listBlock = t => (splitList(t).length ? `<ul class="r-plain">${splitList(t).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '');

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
    const about = summary !== undefined && (summary || E.on) ? `<p class="b-summary">${E.f('summary', summary, SUMMARY_HINT)}</p>` : '';
    return `<header class="b-head${photo ? ' has-photo' : ''}">
      <div class="b-top">${photo}<div class="b-id"><div class="r-name">${name}</div>${title}${about}</div></div>
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
  return `<div class="page tpl-${esc(doc.templateId)}" style="${style}">${inner}</div>`;
}

/**
 * @param {object} r CV
 * @param {{editable?: boolean}} [opts] editable: text is edited in place and the page shows controls
 *   (live preview only, never thumbnails or PDF)
 */
export function renderResume(r, opts = {}) {
  const E = opts.editable ? editing(true) : PLAIN;
  const t = templateOf(r.templateId);
  const summary = section('Summary', summaryHtml(r, E));
  const experience = section('Experience', experienceHtml(r, E));
  const education = section('Education', educationHtml(r, E));
  const projects = section('Projects', projectsHtml(r, E));
  const achievements = section('Achievements', achievementsHtml(r, E));
  const panel = (title, inner, group, path) => panelSection(E, title, inner, group, path);

  if (t.layout === 'side-left' || t.layout === 'side-right') {
    const contacts = contactItems(r.personal);
    const contactSec = contacts.length ? section('Contact', `<ul class="r-plain">${contacts.map(c => `<li>${c}</li>`).join('')}</ul>`) : '';
    const sideRest = [
      panel('Skills', skillsList(r), 'skills', 'skills'),
      panel('Languages', entriesList(r.languages), 'extra', 'languages'),
      panel('Certifications', entriesList(r.certifications), 'extra', 'certifications'),
      panel('Interests', listBlock(r.interests), 'interests', 'interests'),
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
      panel('Languages', entriesList(r.languages, { levels: true }), 'extra', 'languages'),
      t.sideEducation ? education : '',
      achievements,
      panel('Interests', listBlock(r.interests), 'interests', 'interests'),
    ].join('');
    const main = `${experience}${t.sideEducation ? '' : education}${projects}`;
    return pageWrap(r, `${header(r.personal, 'banner', E, r.summary)}<div class="b-body p-cols"><main class="r-main">${main}</main>${side ? `<aside class="r-side">${side}</aside>` : ''}</div>`);
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
