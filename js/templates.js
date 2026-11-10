// Document templates. Each template renders a CV and a matching cover letter into an A4 ".page".
import { FONTS, splitLines, splitList } from './data.js';

export const TEMPLATES = [
  { id: 'banner', name: 'Banner', tags: ['ats', 'single'], desc: 'Two-tone header band with an icon contact row. Letters get bold section sub-headings.' },
  { id: 'classic', name: 'Classic', tags: ['ats', 'single'], desc: 'Centered header, single column. Safest choice for applicant tracking systems.' },
  { id: 'minimal', name: 'Minimal', tags: ['ats', 'single'], desc: 'Quiet, left-aligned layout with hairline rules. Great for conservative industries.' },
  { id: 'executive', name: 'Executive', tags: ['ats', 'single'], desc: 'Bold color header band for senior and leadership roles.' },
  { id: 'tech', name: 'Tech', tags: ['ats', 'single'], desc: 'Skills up front as chips — built for engineering and IT roles.' },
  { id: 'modern', name: 'Modern', tags: ['two-col', 'creative'], desc: 'Colored sidebar with contact, skills and languages.' },
  { id: 'compact', name: 'Compact', tags: ['two-col'], desc: 'Dense two-column layout that fits a lot on one page.' },
];

export const TEMPLATE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'ats', label: 'ATS-optimized' },
  { id: 'single', label: 'Single column' },
  { id: 'two-col', label: 'Two column' },
  { id: 'creative', label: 'Creative' },
];

export const esc = s =>
  String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fontCss = id => (FONTS.find(f => f.id === id) || FONTS[0]).css;
const dates = (a, b) => [a, b].filter(Boolean).map(esc).join(' – ');

function contactItems(p) {
  return [p.email, p.phone, p.location, p.website, p.linkedin, p.github].filter(Boolean).map(esc);
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

/** Contact items with icons; LinkedIn/GitHub shown as handles like on a printed letterhead. */
function iconContacts(p) {
  const handle = v => v.replace(/^https?:\/\//, '').replace(/^(www\.)?(linkedin\.com\/in|github\.com)\//i, '').replace(/\/$/, '');
  return [
    ['email', p.email, 'b-upper'],
    ['phone', p.phone],
    ['location', p.location],
    ['website', p.website],
    ['linkedin', p.linkedin && handle(p.linkedin)],
    ['github', p.github && handle(p.github)],
  ]
    .filter(([, v]) => v)
    .map(([k, v, cls]) => `<span class="b-ci ${cls || ''}">${ICONS[k]}<span>${esc(v)}</span></span>`)
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

function section(title, inner) {
  return inner ? `<section class="r-sec"><h3 class="r-h">${esc(title)}</h3>${inner}</section>` : '';
}

function experienceHtml(r) {
  if (!r.experience.length) return '';
  return r.experience
    .map(e => {
      const bullets = splitLines(e.bullets);
      return `<div class="r-item">
        <div class="r-row"><strong>${esc(e.role) || 'Role'}</strong><span class="r-date">${dates(e.start, e.end)}</span></div>
        <div class="r-row r-sub"><span>${esc(e.company)}</span><span>${esc(e.location)}</span></div>
        ${bullets.length ? `<ul>${bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul>` : ''}
      </div>`;
    })
    .join('');
}

function educationHtml(r) {
  if (!r.education.length) return '';
  return r.education
    .map(
      e => `<div class="r-item">
        <div class="r-row"><strong>${esc(e.degree) || 'Degree'}</strong><span class="r-date">${dates(e.start, e.end)}</span></div>
        <div class="r-row r-sub"><span>${esc(e.school)}</span><span>${esc(e.location)}</span></div>
        ${e.details ? `<p class="r-p">${esc(e.details)}</p>` : ''}
      </div>`
    )
    .join('');
}

function projectsHtml(r) {
  if (!r.projects.length) return '';
  return r.projects
    .map(
      p => `<div class="r-item"><div class="r-row"><strong>${esc(p.name)}</strong><span class="r-date">${esc(p.link)}</span></div>
      ${p.description ? `<p class="r-p">${esc(p.description)}</p>` : ''}</div>`
    )
    .join('');
}

const skillsInline = r => (splitList(r.skills).length ? `<p class="r-p">${splitList(r.skills).map(esc).join(' · ')}</p>` : '');
const skillsChips = r => (splitList(r.skills).length ? `<div class="r-chips">${splitList(r.skills).map(s => `<span>${esc(s)}</span>`).join('')}</div>` : '');
const skillsList = r => (splitList(r.skills).length ? `<ul class="r-plain">${splitList(r.skills).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '');
const textBlock = t => (t ? `<p class="r-p">${esc(t)}</p>` : '');
const listBlock = t => (splitList(t).length ? `<ul class="r-plain">${splitList(t).map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '');

function header(p, variant) {
  const name = esc(p.name) || 'Your Name';
  const contacts = contactItems(p);
  if (variant === 'sidebar') {
    return `<div class="r-name">${name}</div>${p.title ? `<div class="r-title">${esc(p.title)}</div>` : ''}`;
  }
  if (variant === 'banner') {
    const ci = iconContacts(p);
    return `<header class="b-head">
      <div class="b-top"><div class="r-name">${name}</div>${p.title ? `<div class="r-title">${esc(p.title)}</div>` : ''}</div>
      ${ci ? `<div class="b-contact">${ci}</div>` : ''}
    </header>`;
  }
  return `<header class="r-header">
    <div class="r-name">${name}</div>
    ${p.title ? `<div class="r-title">${esc(p.title)}</div>` : ''}
    ${contacts.length ? `<div class="r-contact">${contacts.map(c => `<span>${c}</span>`).join('')}</div>` : ''}
  </header>`;
}

function pageWrap(doc, inner) {
  const style = `--accent:${esc(doc.theme.color)};--font:${fontCss(doc.theme.font)}`;
  return `<div class="page tpl-${esc(doc.templateId)}" style="${style}">${inner}</div>`;
}

export function renderResume(r) {
  const t = r.templateId;
  const main = [
    section('Summary', textBlock(r.summary)),
    section('Experience', experienceHtml(r)),
    section('Education', educationHtml(r)),
    section('Projects', projectsHtml(r)),
  ];

  if (t === 'modern' || t === 'compact') {
    const contacts = contactItems(r.personal);
    const contactSec = contacts.length ? section('Contact', `<ul class="r-plain">${contacts.map(c => `<li>${c}</li>`).join('')}</ul>`) : '';
    const sideRest = [
      section('Skills', skillsList(r)),
      section('Languages', listBlock(r.languages)),
      section('Certifications', listBlock(r.certifications)),
    ].join('');
    if (t === 'modern') {
      return pageWrap(r, `<div class="r-cols"><aside class="r-side">${header(r.personal, 'sidebar')}${contactSec}${sideRest}</aside><main class="r-main">${main.join('')}</main></div>`);
    }
    return pageWrap(r, `${header(r.personal)}<div class="r-cols"><main class="r-main">${main.join('')}</main><aside class="r-side">${sideRest}</aside></div>`);
  }

  const skills = section('Skills', t === 'tech' ? skillsChips(r) : skillsInline(r));
  const extras = [section('Certifications', listBlock(r.certifications)), section('Languages', textBlock(r.languages))];
  const order = t === 'tech' ? [main[0], skills, main[1], main[3], main[2], ...extras] : [...main.slice(0, 3), skills, main[3], ...extras];
  if (t === 'banner') return pageWrap(r, header(r.personal, 'banner') + `<div class="b-body">${order.join('')}</div>`);
  return pageWrap(r, header(r.personal) + order.join(''));
}

/**
 * @param {object} l letter
 * @param {{editable?: boolean}} [opts] editable: render the body as an in-page editor (live preview only, never print/PDF)
 */
export function renderLetter(l, opts = {}) {
  const t = l.templateId;
  const rec = l.recipient;
  const recipientLines = [rec.name, rec.title, rec.company, rec.address].filter(Boolean).map(esc);
  const blocks = opts.editable
    ? `<div class="l-edit" contenteditable="true" spellcheck="true" role="textbox" aria-multiline="true" aria-label="Letter body" data-edit="body" data-placeholder="Click here and write your letter…">${letterBlocks(l.body)}</div>`
    : letterBlocks(l.body) || '<p class="l-placeholder">Your letter will appear here…</p>';
  // In the live preview, single-line fields are editable in place; elsewhere ef() returns the plain text.
  const ef = (path, html, label) => (opts.editable
    ? `<span class="l-field" contenteditable="plaintext-only" spellcheck="true" role="textbox" aria-label="${label}" data-edit-field="${path}" data-placeholder="${label}">${html}</span>`
    : html);
  // "To" and the closing are always printed; empty fields fall back to sensible defaults.
  let toLines;
  if (opts.editable) {
    const nameShown = esc(rec.name) || (recipientLines.length ? '' : 'Hiring Manager');
    toLines = [ef('recipient.name', nameShown, 'Recipient name'),
      ...['title', 'company', 'address'].filter(k => rec[k]).map(k => ef(`recipient.${k}`, esc(rec[k]), `Recipient ${k}`))];
  } else {
    toLines = recipientLines.length ? recipientLines : ['Hiring Manager'];
  }
  const closing = ef('closing', esc(l.closing?.trim() || 'Sincerely,'), 'Closing');
  const signer = esc(l.personal.name) || 'Your Name';
  const greeting = ef('greeting', esc(l.greeting?.trim() || 'Dear Hiring Manager,'), 'Greeting');
  const date = ef('date', esc(l.date), 'Date');
  if (t === 'banner') {
    return pageWrap(l, `${header(l.personal, 'banner')}<div class="b-body l-banner">
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
  if (t === 'modern') {
    const contacts = contactItems(l.personal);
    return pageWrap(l, `<div class="r-cols"><aside class="r-side">${header(l.personal, 'sidebar')}${
      contacts.length ? section('Contact', `<ul class="r-plain">${contacts.map(c => `<li>${c}</li>`).join('')}</ul>`) : ''
    }</aside><main class="r-main">${body}</main></div>`);
  }
  return pageWrap(l, header(l.personal) + body);
}

export const renderDoc = (d, opts) => (d.type === 'cover' ? renderLetter(d, opts) : renderResume(d));
