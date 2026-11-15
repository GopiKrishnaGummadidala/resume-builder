// The document editor: the page itself is the editor. Text is typed directly on the page; a tool rail
// opens two side panels, "All fields" (the complete form) and "Coach". The page and the form edit the
// same in-memory document; every change is saved through the store.
import {
  draftLetterBody, THEME_COLORS, FONTS, uid, splitLines, DEFAULT_PERSONAL, LETTER_TITLE, letterTitle,
  PAGE_SIZES, SPACING_STEPS, MARGIN_STEPS, DEFAULT_SPACING, DEFAULT_MARGIN, pageSize, validPhoto, splitList, cleanTags, TAG_LIMITS,
} from './data.js';
import { store } from './store.js';
import { TEMPLATES, renderDoc, esc, letterBlocks, sectionLayout } from './templates.js';
import { coachResume, coachLetter, strengthenBullet } from './analysis.js';
import { htmlToLetterText, editableToLetterText, editableToLines, toggleBold, toggleHeading, editableBold, editableHeading } from './richtext.js';
import { $, $$, toast, confirmDialog, fileNameDialog, setPath, getPath } from './ui.js';
import { saveFile } from './platform.js';
import { buildPdf, pdfName } from './pdf-export.js';
import { fitOnePage } from './fit.js';
import { fitPages, pageObserver } from './preview.js';
import { createHistory } from './history.js';
import { paginate, unpaginate } from './paginate.js';
import { fileToPhoto } from './photo.js';
import { fileToDoc } from './importer.js';

function field(label, path, doc, opts = {}) {
  const v = getPath(doc, path) ?? '';
  const id = `f_${path.replace(/\./g, '_')}`;
  const input = opts.textarea
    ? `<textarea id="${id}" data-path="${path}" rows="${opts.rows || 4}" placeholder="${esc(opts.ph || '')}">${esc(v)}</textarea>`
    : `<input id="${id}" data-path="${path}" value="${esc(v)}" placeholder="${esc(opts.ph || '')}" type="${opts.type || 'text'}">`;
  return `<label class="field ${opts.full ? 'full' : ''}" for="${id}"><span>${label}</span>${input}${opts.hint ? `<small>${opts.hint}</small>` : ''}</label>`;
}

function group(title, key, inner, open = true) {
  return `<details class="group" data-group="${key}" ${open ? 'open' : ''}><summary>${title}</summary><div class="group-body">${inner}</div></details>`;
}

function listItem(doc, listKey, i, title, inner) {
  const len = doc[listKey].length;
  return `<div class="list-item">
    <div class="list-item-head"><strong>${esc(title)}</strong>
      <span class="li-actions">
        <button class="icon-btn" data-act="move" data-list="${listKey}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled' : ''} title="Move up">↑</button>
        <button class="icon-btn" data-act="move" data-list="${listKey}" data-i="${i}" data-dir="1" ${i === len - 1 ? 'disabled' : ''} title="Move down">↓</button>
        <button class="icon-btn danger" data-act="remove-item" data-list="${listKey}" data-i="${i}" title="Remove">✕</button>
      </span>
    </div>
    <div class="grid2">${inner}</div>
  </div>`;
}

const hasDefaults = () => Object.values(DEFAULT_PERSONAL).some(Boolean);

function personalFields(doc) {
  const reset = hasDefaults()
    ? `<div><button class="btn btn-sm btn-ghost" data-act="reset-personal" title="Fill name, phone, email and links with your saved defaults">↺ Reset to my details</button></div>`
    : '';
  const photo = validPhoto(doc.personal.photo);
  return `${reset}<div class="photo-row">
      ${photo ? `<img class="photo-thumb" src="${esc(photo)}" alt="Your photo">` : '<span class="photo-thumb photo-empty" aria-hidden="true">☺</span>'}
      <div>
        <label class="btn btn-sm btn-ghost photo-pick">${photo ? 'Change photo' : 'Add photo'}<input type="file" accept="image/jpeg,image/png,image/webp" data-role="photo" class="visually-hidden"></label>
        ${photo ? '<button type="button" class="btn btn-sm btn-ghost" data-act="remove-photo">Remove</button>' : ''}
        <p class="muted small">Optional. Shown in the header; cropped to a square and stored only in this browser.</p>
      </div>
    </div>
    <div class="grid2">
    ${field('Full name', 'personal.name', doc, { ph: 'Jordan Rivera' })}
    ${field('Headline / job title', 'personal.title', doc, { ph: 'Senior Product Designer' })}
    ${field('Email', 'personal.email', doc, { type: 'email', ph: 'you@example.com' })}
    ${field('Phone', 'personal.phone', doc, { ph: '+1 555 0100' })}
    ${field('Location', 'personal.location', doc, { ph: 'City, Country' })}
    ${field('Website', 'personal.website', doc, { ph: 'yoursite.com' })}
    ${field('LinkedIn', 'personal.linkedin', doc, { ph: 'linkedin.com/in/you' })}
    ${field('GitHub', 'personal.github', doc, { ph: 'github.com/you' })}
  </div>`;
}

function resumeForm(r) {
  const exp = r.experience.map((e, i) => listItem(r, 'experience', i, e.role || e.company || `Position ${i + 1}`, `
      ${field('Job title', `experience.${i}.role`, r)}
      ${field('Company', `experience.${i}.company`, r)}
      ${field('About the company (optional)', `experience.${i}.about`, r, { full: true, ph: 'What it does, its size or market, in one line' })}
      ${field('Start', `experience.${i}.start`, r, { ph: '2021' })}
      ${field('End', `experience.${i}.end`, r, { ph: 'Present' })}
      ${field('Location', `experience.${i}.location`, r, { full: true })}
      ${field('Achievements (one per line)', `experience.${i}.bullets`, r, { textarea: true, rows: 5, full: true, ph: 'Led redesign of onboarding, increasing activation by 23%', hint: '3–6 bullets. Start with an action verb and add a number where you can. **text** is bold.' })}
      <div class="full"><button class="btn btn-sm btn-ghost" data-act="strengthen" data-i="${i}">✨ Strengthen bullets</button></div>`)).join('');
  const edu = r.education.map((e, i) => listItem(r, 'education', i, e.degree || e.school || `Education ${i + 1}`, `
      ${field('Degree', `education.${i}.degree`, r)}
      ${field('School', `education.${i}.school`, r)}
      ${field('Start', `education.${i}.start`, r)}
      ${field('End', `education.${i}.end`, r)}
      ${field('Location', `education.${i}.location`, r)}
      ${field('Details', `education.${i}.details`, r, { ph: 'GPA, honours, thesis…' })}`)).join('');
  const proj = r.projects.map((p, i) => listItem(r, 'projects', i, p.name || `Project ${i + 1}`, `
      ${field('Name', `projects.${i}.name`, r)}
      ${field('Link', `projects.${i}.link`, r)}
      ${field('Description', `projects.${i}.description`, r, { full: true })}`)).join('');
  const ach = r.achievements.map((a, i) => listItem(r, 'achievements', i, a.title || `Achievement ${i + 1}`, `
      ${field('Title', `achievements.${i}.title`, r)}
      ${field('Date', `achievements.${i}.date`, r, { ph: 'Mar 2023' })}
      ${field('What you did and the result', `achievements.${i}.description`, r, { textarea: true, rows: 3, full: true })}`)).join('');
  return [
    group('Personal details', 'personal', personalFields(r)),
    group('Professional summary', 'summary', field('Summary', 'summary', r, { textarea: true, rows: 4, full: true, ph: '2–4 sentences: who you are, your strongest results, what you want next.' })),
    group('Work experience', 'experience', `${exp}<button class="btn btn-dashed" data-act="add-item" data-list="experience">+ Add position</button>`),
    group('Education', 'education', `${edu}<button class="btn btn-dashed" data-act="add-item" data-list="education">+ Add education</button>`),
    group('Skills', 'skills', field('Skills (comma separated)', 'skills', r, { textarea: true, rows: 3, full: true, ph: 'Figma, SQL, Stakeholder management…' })),
    group('Projects', 'projects', `${proj}<button class="btn btn-dashed" data-act="add-item" data-list="projects">+ Add project</button>`, r.projects.length > 0),
    group('Certifications & languages', 'extra', `<div class="grid2">
      ${field('Certifications (one per line)', 'certifications', r, { textarea: true, rows: 3, full: true, ph: 'Solutions Associate | Microsoft | Feb 2019', hint: 'Name | issuer | date. The issuer and date are optional.' })}
      ${field('Languages (one per line)', 'languages', r, { textarea: true, rows: 2, full: true, ph: 'German | Elementary', hint: 'Language | level, for example Native, Fluent, Professional, Intermediate, Elementary.' })}</div>`, !!(r.certifications || r.languages)),
    group('Achievements', 'achievements', `${ach}<button class="btn btn-dashed" data-act="add-item" data-list="achievements">+ Add achievement</button>`, r.achievements.length > 0),
    group('Interests', 'interests', field('Interests (comma separated)', 'interests', r, { full: true, ph: 'Trail running, Open-source' }), !!r.interests),
  ].join('');
}

function letterForm(l) {
  const resumes = store.docs.filter(d => d.type !== 'cover');
  return [
    group('Target job', 'job', `<div class="grid2">
      ${field('Job title you are applying for', 'job.role', l, { ph: 'Lead Product Designer' })}
      ${field('Where you found it (optional)', 'job.source', l, { ph: 'LinkedIn, a referral from…' })}
    </div>`),
    group('To (recipient)', 'recipient', `<div class="grid2">
      ${field('Hiring manager name', 'recipient.name', l, { ph: 'Taylor Chen' })}
      ${field('Their title', 'recipient.title', l, { ph: 'Head of Design' })}
      ${field('Company', 'recipient.company', l, { ph: 'Acme Corp' })}
      ${field('Company address', 'recipient.address', l)}
    </div>`),
    group('Letter', 'letter', `
      <div class="draft-box">
        <div><strong>Draft from a CV</strong><p class="muted small">Fills the body using your CV's headline, latest role and skills. You edit from there.</p></div>
        <div class="draft-controls">
          <select data-role="draft-src">${resumes.length ? resumes.map(r => `<option value="${r.id}">${esc(r.title)}</option>`).join('') : '<option value="">No CVs yet</option>'}</select>
          <button class="btn btn-sm btn-primary" data-act="draft" ${resumes.length ? '' : 'disabled'}>Write draft</button>
        </div>
      </div>
      <div class="grid2">
        ${field('Date', 'date', l)}
        ${field('Greeting', 'greeting', l)}
        <div class="fmt-bar full" role="toolbar" aria-label="Letter formatting">
          <button type="button" class="btn btn-sm btn-ghost" data-act="fmt-bold" title="Bold the selected text (Ctrl+B)"><strong>B</strong> Bold</button>
          <button type="button" class="btn btn-sm btn-ghost" data-act="fmt-heading" title="Make the selected line a bold sub-heading">Heading</button>
          <span class="muted small">Or edit the letter directly on the page. Pasting from Word or Google Docs keeps bold.</span>
        </div>
        ${field('Body', 'body', l, { textarea: true, rows: 16, full: true, ph: 'Opening: the role and why you are excited.\n\n# Sub-heading\nAn achievement that proves you can do the job.\n\nClose: thank them and ask for a conversation.', hint: 'Blank line = new paragraph · a line starting with “# ” is a bold sub-heading · **text** is bold' })}
        ${field('Closing', 'closing', l, { ph: 'Sincerely,', hint: 'Printed above your name at the bottom of the letter' })}
      </div>`),
    group('Your details', 'personal', `${resumes.length ? `<button class="btn btn-sm btn-ghost" data-act="copy-personal">Copy details from my CV</button>` : ''}${personalFields(l)}`, !l.personal.name),
  ].join('');
}

function coachPanel(doc) {
  const { score, checks } = doc.type === 'cover' ? coachLetter(doc) : coachResume(doc);
  const todo = checks.filter(c => !c.ok);
  const done = checks.filter(c => c.ok);
  const level = score >= 80 ? 'good' : score >= 55 ? 'ok' : 'low';
  return `<div class="score score-${level}"><div class="ring" style="--p:${score}"><span>${score}</span></div>
      <div><strong>${doc.type === 'cover' ? 'Letter' : 'CV'} score</strong><p class="muted small">${todo.length ? `${todo.length} suggestion${todo.length > 1 ? 's' : ''} to improve` : 'Looking great!'}</p></div></div>
    <ul class="checks">${todo.map(c => `<li class="todo">${esc(c.text)}</li>`).join('')}${done.map(c => `<li class="done">${esc(c.text.replace(/ — .*$/, ''))}</li>`).join('')}</ul>`;
}

/** Layout, Fonts and Themes menus. Each is a <details> so it opens and closes without script. */
const SECTION_NAMES = {
  summary: 'Summary', experience: 'Work experience', projects: 'Projects', education: 'Education', skills: 'Skills',
  certifications: 'Certificates', languages: 'Languages', achievements: 'Achievements', interests: 'Interests',
};

/** The Sections menu: each section with up/down buttons and, in two-column templates, a button to change column. */
function sectionsPanel(doc) {
  const L = sectionLayout(doc);
  const row = (k, i, keys, col) => {
    const name = SECTION_NAMES[k] || k;
    const other = col === 'main' ? 'side' : 'main';
    return `<li class="sec-row"><span>${name}</span>
      <button type="button" class="icon-btn" data-sec-move="up" data-key="${k}" ${i === 0 ? 'disabled' : ''} aria-label="Move ${name} up" title="Move up">↑</button>
      <button type="button" class="icon-btn" data-sec-move="down" data-key="${k}" ${i === keys.length - 1 ? 'disabled' : ''} aria-label="Move ${name} down" title="Move down">↓</button>
      ${L.twoCol ? `<button type="button" class="btn btn-sm btn-ghost" data-sec-col="${k}" aria-label="Move ${name} to the ${other} column">${col === 'main' ? 'To side' : 'To main'}</button>` : ''}
    </li>`;
  };
  const list = (keys, col, title) => `<div class="sec-col">${title ? `<p class="sec-col-h">${title}</p>` : ''}<ol class="sec-list">${
    keys.map((k, i) => row(k, i, keys, col)).join('') || '<li class="muted small">No sections here</li>'}</ol></div>`;
  return `${L.twoCol ? list(L.main, 'main', 'Main column') + list(L.side, 'side', 'Side column') : list(L.main, 'main', '')}
    ${L.inHeader.length ? '<p class="muted small">This template shows your summary in the header.</p>' : ''}
    <p class="muted small">Your order stays when you switch templates.</p>
    <button type="button" class="btn btn-sm btn-ghost" data-sec-reset ${doc.sections ? '' : 'disabled'}>Use the template's order</button>`;
}

function toolbarMenus(doc) {
  const range = (role, label, steps, value) => `<label class="tb-range"><span>${label}</span>
      <input type="range" data-role="${role}" min="1" max="${steps.length}" step="1" value="${value}" aria-label="${label}">
      <span class="tb-ends muted small"><span>Min</span><span>Max</span></span></label>`;
  return `<details class="tb-menu" data-menu="layout"><summary class="btn btn-sm btn-ghost">Layout</summary>
      <div class="tb-pop">
        ${range('spacing', 'Content spacing', SPACING_STEPS, doc.theme.spacing ?? DEFAULT_SPACING)}
        ${range('margin', 'Page margins', MARGIN_STEPS, doc.theme.margin ?? DEFAULT_MARGIN)}
        <fieldset class="tb-size"><legend>Page size</legend>
          ${Object.entries(PAGE_SIZES).map(([id, s]) => `<label><input type="radio" name="page-size" data-role="size" value="${id}" ${pageSize(doc) === s ? 'checked' : ''}> ${s.label}</label>`).join('')}
        </fieldset>
        <label class="tb-check"><input type="checkbox" data-role="icons" ${doc.theme.icons !== false ? 'checked' : ''}> Show icons <span class="muted small">(section, contact and interest icons)</span></label>
        <label class="tb-check"><input type="checkbox" data-role="full-links" ${doc.theme.fullLinks !== false ? 'checked' : ''}> Full profile links <span class="muted small">(linkedin.com/in/… instead of the handle; ATS-friendly)</span></label>
        <label class="tb-check"><input type="checkbox" data-role="profile-heading" ${doc.theme.profileHeading !== false ? 'checked' : ''}> Profile heading <span class="muted small">(over a summary in the header; ATS-friendly)</span></label>
        <button type="button" class="btn btn-sm btn-ghost" data-act="layout-reset">Reset layout</button>
      </div>
    </details>
    ${doc.type === 'cover' ? '' : `<details class="tb-menu" data-menu="sections"><summary class="btn btn-sm btn-ghost">Sections</summary>
      <div class="tb-pop tb-sections">${sectionsPanel(doc)}</div>
    </details>`}
    <details class="tb-menu" data-menu="fonts"><summary class="btn btn-sm btn-ghost">Fonts</summary>
      <div class="tb-pop tb-list">
        ${FONTS.map(f => `<button type="button" class="tb-option ${f.id === doc.theme.font ? 'active' : ''}" data-act="font" data-font="${f.id}" style="font-family:${esc(f.css)}">${esc(f.label)}</button>`).join('')}
      </div>
    </details>
    <details class="tb-menu" data-menu="themes"><summary class="btn btn-sm btn-ghost">Themes</summary>
      <div class="tb-pop">
        <div class="swatches">${THEME_COLORS.map(c => `<button class="swatch ${c === doc.theme.color ? 'active' : ''}" style="--c:${c}" data-act="color" data-color="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
        <label class="tb-custom"><span>Custom colour</span><input type="color" data-role="color" value="${esc(doc.theme.color)}" aria-label="Custom colour"></label>
      </div>
    </details>`;
}

/** Sections with nothing in them yet, offered below the page (an empty section is not drawn on it). */
function addSections(doc) {
  if (doc.type === 'cover') return '';
  const lists = [['experience', 'Experience'], ['education', 'Education'], ['projects', 'Projects'], ['achievements', 'Achievements']]
    .filter(([key]) => !doc[key]?.length)
    .map(([key, label]) => `<button type="button" class="btn btn-sm btn-ghost" data-act="add-item" data-list="${key}">+ ${label}</button>`);
  const panels = [['skills', 'skills', 'Skills'], ['extra', 'certifications', 'Certifications'], ['extra', 'languages', 'Languages'], ['interests', 'interests', 'Interests']]
    .filter(([, path]) => !splitList(doc[path]).length)
    .map(([group, path, label]) => `<button type="button" class="btn btn-sm btn-ghost" data-edit-open="${group}" data-edit-focus="${path}">+ ${label}</button>`);
  const all = [...lists, ...panels];
  return all.length ? `<span class="muted small">Add a section:</span>${all.join('')}` : '';
}

/** Which side panels are open. Remembered in this browser; both are closed the first time. */
const PREFS_KEY = 'craftfolio.ui';
const panels = { form: false, coach: false };
try {
  const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  panels.form = saved.form === true;
  panels.coach = saved.coach === true;
} catch { /* no saved preference, or storage is unavailable */ }
const savePanels = () => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(panels)); } catch { /* not remembered */ } };

/** The document's tags, each with a remove button. */
const tagChips = doc => (doc.tags || []).map(t => `<span class="tag-chip">${esc(t)}<button type="button" data-tag-remove="${esc(t)}" aria-label="Remove tag ${esc(t)}" title="Remove tag">×</button></span>`).join('');
/** Tags used on other documents and not on this one, offered while typing. */
const tagOptions = doc => {
  const mine = new Set((doc.tags || []).map(t => t.toLowerCase()));
  const all = [...new Set(store.docs.flatMap(d => d.tags || []))].filter(t => !mine.has(t.toLowerCase()));
  return all.sort((a, b) => a.localeCompare(b)).map(t => `<option value="${esc(t)}"></option>`).join('');
};

export function editorPage(id) {
  const doc = store.get(id);
  if (!doc) return `<section class="section"><h1>Document not found</h1><a class="btn btn-primary" href="#documents">Back to my documents</a></section>`;
  doc.type = doc.type || 'resume';
  return `<div class="editor" data-id="${doc.id}">
    <div class="ed-toolbar no-print">
      <a class="btn btn-sm btn-ghost" href="#documents">← Documents</a>
      <input class="title-input" data-path="title" value="${esc(doc.title)}" aria-label="Document name">
      <div class="doc-tags" role="group" aria-label="Tags"><span class="tag-list">${tagChips(doc)}</span><input class="tag-input" list="tag-suggest" maxlength="${TAG_LIMITS.length}" placeholder="+ Tag" aria-label="Add a tag, such as .NET or Angular" title="Tags help you find versions of this document in My documents (Enter to add)"><datalist id="tag-suggest">${tagOptions(doc)}</datalist></div>
      <div class="tb-group">
        <button class="icon-btn" data-act="undo" title="Undo (Ctrl+Z)" aria-label="Undo" disabled>↶</button>
        <button class="icon-btn" data-act="redo" title="Redo (Ctrl+Y)" aria-label="Redo" disabled>↷</button>
        <select data-role="template" aria-label="Template">${TEMPLATES.map(t => `<option value="${t.id}" ${t.id === doc.templateId ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
        ${toolbarMenus(doc)}
      </div>
      <div class="tb-group">
        <button class="btn btn-sm btn-primary" data-act="download">⬇ Download PDF</button>
      </div>
    </div>
    <div class="ed-body">
      <nav class="ed-rail no-print" aria-label="Editor tools">
        <button type="button" class="rail-btn" data-act="panel" data-panel="form" aria-pressed="${panels.form}"><span class="rail-ico" aria-hidden="true">☰</span><span>All fields</span></button>
        <button type="button" class="rail-btn" data-act="panel" data-panel="coach" aria-pressed="${panels.coach}"><span class="rail-ico" aria-hidden="true">◔</span><span>Coach</span><span class="rail-badge" id="rail-score"></span></button>
        ${doc.type !== 'cover' ? `<a class="rail-btn" href="#tailor-${doc.id}"><span class="rail-ico" aria-hidden="true">✦</span><span>Tailor to job</span></a>
        <a class="rail-btn" href="#match-${doc.id}"><span class="rail-ico" aria-hidden="true">⇄</span><span>Match to job</span></a>
        <a class="rail-btn" href="#ats"><span class="rail-ico" aria-hidden="true">✓</span><span>ATS checker</span></a>` : ''}
        <a class="rail-btn" href="#templates${doc.type === 'cover' ? '-cover' : ''}"><span class="rail-ico" aria-hidden="true">▦</span><span>Templates</span></a>
        ${doc.type !== 'cover' ? `<label class="rail-btn" title="Fill this CV from an existing CV (PDF, text or Craftfolio JSON). Its template and design stay."><span class="rail-ico" aria-hidden="true">⭱</span><span>Import CV</span><input type="file" accept=".pdf,.txt,.json" data-role="import-into" hidden></label>` : ''}
        <button type="button" class="rail-btn" data-act="export-json"><span class="rail-ico" aria-hidden="true">⭳</span><span>Export JSON</span></button>
      </nav>
      <div class="ed-form no-print" ${panels.form ? '' : 'hidden'}>${doc.type === 'cover' ? letterForm(doc) : resumeForm(doc)}</div>
      <div class="ed-preview">
        <p class="edit-tip no-print">Click any text on the page to edit it. ${doc.type === 'cover' ? 'Ctrl+B for bold.' : 'Use + to add an entry and ✎ for contact details, photo and skills.'}</p>
        <div class="page-fit" id="live">${renderDoc(doc, { editable: true })}</div>
        <p class="overflow-warn" hidden></p>
        <div class="add-sections no-print"></div>
      </div>
      <aside class="ed-coach no-print" id="coach" ${panels.coach ? '' : 'hidden'}>${coachPanel(doc)}</aside>
    </div>
  </div>`;
}

export function mountEditor() {
  const root = $('.editor');
  if (!root) return;
  const doc = store.get(root.dataset.id);
  const live = $('#live');
  pageObserver.observe(live);

  // Size, overflow warning and coach — everything except re-rendering the page itself.
  const updateAround = () => {
    fitPages(root);
    showPageBreaks();
    $('#coach').innerHTML = coachPanel(doc);
    $('#rail-score').textContent = $('#coach .ring span').textContent;
  };

  // Side panels (the complete form, the coach), opened from the tool rail.
  const setPanel = (name, open) => {
    panels[name] = open;
    savePanels();
    $(name === 'form' ? '.ed-form' : '#coach', root).hidden = !open;
    $(`[data-panel="${name}"]`, root).setAttribute('aria-pressed', String(open));
    fitPages(root);
  };
  /** Open the form at one field: for content that is not typed on the page (contact, photo, skills). */
  const openField = (groupKey, path) => {
    setPanel('form', true);
    const group = $(`.ed-form .group[data-group="${groupKey}"]`, root);
    if (group) group.open = true;
    const input = $(`.ed-form [data-path="${path}"]`, root);
    input?.focus();
    input?.scrollIntoView({ block: 'center' });
  };
  // Dashed lines where each PDF page ends, and the page count under the preview.
  function showPageBreaks() {
    const page = $('.page', live);
    const pageH = pageSize(doc).H;
    const scale = page.getBoundingClientRect().height / page.offsetHeight || 1;
    const pages = Math.max(1, Math.ceil((page.scrollHeight - 2) / pageH));
    $$('.page-break', live).forEach(mark => mark.remove());
    for (let k = 1; k < pages; k++) {
      const mark = document.createElement('div');
      mark.className = 'page-break no-print';
      mark.dataset.label = `Page ${k + 1}`;
      mark.style.top = `${k * pageH * scale}px`;
      live.appendChild(mark);
    }
    const warn = $('.overflow-warn', root);
    warn.hidden = pages < 2;
    warn.textContent = `${pages} pages in the PDF. Dashed lines show where each page ends; entries and lines are never cut in two.`;
  }
  const refresh = () => {
    live.innerHTML = renderDoc(doc, { editable: true });
    // Replaced only when it changes: leaving a text field redraws the page between the press and the
    // release of a click, and a button replaced in that moment would never receive the click.
    const strip = $('.add-sections', root);
    const offered = addSections(doc);
    if (strip.dataset.html !== offered) { strip.innerHTML = offered; strip.dataset.html = offered; }
    fitPages(root);
    paginate($('.page', live), pageSize(doc).H); // the preview shows the same page breaks as the PDF
    updateAround();
  };
  // Undo history. A snapshot is the whole document except its save time. Typing is recorded after a
  // short pause so one undo step is a phrase, not a keystroke; other changes are recorded at once.
  const snapshot = () => JSON.stringify({ ...doc, updatedAt: 0 });
  const history = createHistory(snapshot());
  let recordTimer;
  const syncHistoryButtons = () => {
    $('[data-act="undo"]', root).disabled = !history.canUndo;
    $('[data-act="redo"]', root).disabled = !history.canRedo;
  };
  const recordNow = () => { clearTimeout(recordTimer); history.record(snapshot()); syncHistoryButtons(); };
  const recordSoon = () => { clearTimeout(recordTimer); recordTimer = setTimeout(recordNow, 500); };

  const save = () => { store.touch(doc); recordSoon(); }; // debounced write; flushed when the page is hidden
  const commit = () => { store.update(doc); recordNow(); }; // write now
  const rerenderForm = () => {
    const open = new Set($$('.group[open]', root).map(g => g.dataset.group));
    $('.ed-form', root).innerHTML = doc.type === 'cover' ? letterForm(doc) : resumeForm(doc);
    $$('.group', root).forEach(g => (g.open = open.has(g.dataset.group)));
    refresh();
    commit();
  };
  /** Make the toolbar controls show the document's current settings (after undo, redo or a reset). */
  const syncToolbar = () => {
    $('.title-input', root).value = doc.title;
    $('[data-role="template"]', root).value = doc.templateId;
    $('[data-role="spacing"]', root).value = doc.theme.spacing;
    $('[data-role="margin"]', root).value = doc.theme.margin;
    $('[data-role="color"]', root).value = doc.theme.color;
    $$('[data-role="size"]', root).forEach(r => (r.checked = PAGE_SIZES[r.value] === pageSize(doc)));
    $('[data-role="icons"]', root).checked = doc.theme.icons !== false;
    $('[data-role="full-links"]', root).checked = doc.theme.fullLinks !== false;
    $('[data-role="profile-heading"]', root).checked = doc.theme.profileHeading !== false;
    $$('.swatch', root).forEach(s => s.classList.toggle('active', s.dataset.color === doc.theme.color));
    $$('[data-act="font"]', root).forEach(f => f.classList.toggle('active', f.dataset.font === doc.theme.font));
  };
  // Tags: Enter or a comma adds what was typed, Backspace in an empty box removes the last one.
  const renderTags = () => {
    $('.tag-list', root).innerHTML = tagChips(doc);
    $('#tag-suggest', root).innerHTML = tagOptions(doc);
  };
  const addTag = input => {
    const value = input.value.trim();
    input.value = '';
    if (!value) return;
    const before = (doc.tags || []).length;
    doc.tags = cleanTags([...(doc.tags || []), value]);
    if (doc.tags.length === before) toast(before >= TAG_LIMITS.count ? `Up to ${TAG_LIMITS.count} tags` : 'Already tagged');
    renderTags();
    commit();
  };
  root.addEventListener('keydown', e => {
    if (!e.target.matches('.tag-input')) return;
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(e.target); }
    else if (e.key === 'Backspace' && !e.target.value && doc.tags?.length) { doc.tags = doc.tags.slice(0, -1); renderTags(); commit(); }
  });
  root.addEventListener('change', e => { if (e.target.matches('.tag-input')) addTag(e.target); });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-tag-remove]');
    if (!b) return;
    doc.tags = (doc.tags || []).filter(t => t !== b.dataset.tagRemove);
    renderTags();
    commit();
    $('.tag-input', root).focus();
  });

  const restore = snap => {
    if (!snap) return;
    Object.assign(doc, JSON.parse(snap), { updatedAt: doc.updatedAt });
    syncToolbar();
    renderTags();
    renderSections();
    rerenderForm();
  };
  const undo = () => { recordNow(); restore(history.undo()); };
  const redo = () => { recordNow(); restore(history.redo()); };
  root.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.target.closest('input, textarea, select, [contenteditable]')) return; // fields keep their own undo
    const key = e.key.toLowerCase();
    if (key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  });

  // Toolbar menus: only one open at a time; a click elsewhere or Escape closes them.
  const closeMenus = except => $$('.tb-menu[open]', root).forEach(m => { if (m !== except) m.open = false; });
  root.addEventListener('toggle', e => { if (e.target.open && e.target.classList?.contains('tb-menu')) closeMenus(e.target); }, true);
  root.addEventListener('click', e => { if (!e.target.closest('.tb-menu')) closeMenus(); });
  root.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenus(); });

  // Sections menu. Registered after the menu-closing click handler, which must still see the clicked
  // button inside its menu before the menu's content is redrawn.
  function renderSections(focus) {
    const pop = $('.tb-sections', root);
    if (!pop) return;
    pop.innerHTML = sectionsPanel(doc);
    if (focus) (pop.querySelector(focus) || pop.querySelector('button:not([disabled])'))?.focus();
  }
  /** Save a new arrangement; the summary keeps its place in the order even while a template shows it in the header. */
  const saveSections = (L, main, side) => {
    const order = [...main, ...side];
    if (L.inHeader.length) order.splice(Math.max(0, doc.sections?.order?.indexOf('summary') ?? 0), 0, ...L.inHeader);
    doc.sections = L.twoCol ? { order, side } : doc.sections?.side ? { order, side: doc.sections.side } : { order };
  };
  root.addEventListener('click', e => {
    const move = e.target.closest('[data-sec-move]');
    const col = e.target.closest('[data-sec-col]');
    const reset = e.target.closest('[data-sec-reset]');
    if (!move && !col && !reset) return;
    let focus = '';
    if (reset) {
      delete doc.sections;
    } else {
      const L = sectionLayout(doc);
      const main = [...L.main];
      const side = [...L.side];
      const key = (move || col).dataset.key || col?.dataset.secCol;
      const list = main.includes(key) ? main : side;
      const i = list.indexOf(key);
      if (move) {
        const j = move.dataset.secMove === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= list.length) return;
        [list[i], list[j]] = [list[j], list[i]];
        focus = `[data-sec-move="${move.dataset.secMove}"][data-key="${key}"]`;
      } else {
        list.splice(i, 1);
        (list === main ? side : main).push(key);
        focus = `[data-sec-col="${key}"]`;
      }
      saveSections(L, main, side);
    }
    renderSections(focus);
    refresh();
    commit();
  });

  // Layout sliders and the custom colour act while they are dragged.
  root.addEventListener('input', e => {
    const role = e.target.dataset.role;
    if (role === 'spacing' || role === 'margin') doc.theme[role] = Number(e.target.value);
    else if (role === 'color') {
      doc.theme.color = e.target.value;
      $$('.swatch', root).forEach(s => s.classList.toggle('active', s.dataset.color === doc.theme.color));
    } else return;
    refresh();
    save();
  });

  root.addEventListener('input', e => {
    const path = e.target.dataset.path;
    if (!path) return;
    if (path === 'recipient.name' && doc.type === 'cover') syncGreeting(e.target.value);
    const autoTitle = titleIsAuto();
    setPath(doc, path, e.target.value);
    if (autoTitle && path.startsWith('recipient.')) syncTitle();
    refresh();
    save();
  });

  // Letter body: keep bold when pasting formatted text, and Ctrl/Cmd+B to bold the selection.
  const bodyBox = () => $('[data-path="body"]', root);
  root.addEventListener('paste', e => {
    if (e.target !== bodyBox()) return;
    const html = e.clipboardData?.getData('text/html');
    if (!html) return; // plain text: let the browser paste normally
    const text = htmlToLetterText(html);
    if (text == null) return;
    e.preventDefault();
    e.target.setRangeText(text, e.target.selectionStart, e.target.selectionEnd, 'end');
    e.target.dispatchEvent(new Event('input', { bubbles: true }));
    toast('Pasted with bold text kept');
  });
  root.addEventListener('keydown', e => {
    if (e.target === bodyBox() && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleBold(e.target);
    }
  });

  // In-page editing of the letter body (the preview itself). The page is not re-rendered while
  // typing there, so the caret stays put; the form's Body box is kept in sync.
  let lastEditor = null; // body textarea or in-page editor, whichever was used last (for the B / Heading buttons)
  const pageEditor = () => $('.l-edit', live);
  root.addEventListener('focusin', e => {
    // While a block of text is typed in, its page-break spacing is taken out so that a new line made
    // with Enter does not copy it. The page is laid out again when typing ends (focusout).
    const typing = e.target.closest?.('[data-edit-lines], .l-edit');
    if (typing && live.contains(typing)) unpaginate(typing);
    if (e.target === bodyBox()) lastEditor = e.target;
    else if (e.target.classList?.contains('l-edit')) {
      lastEditor = e.target;
      document.execCommand('defaultParagraphSeparator', false, 'p');
    }
  });
  // Single-line fields on the page (recipient, date, greeting, closing).
  const greetingFor = name => `Dear ${name || 'Hiring Manager'},`;
  live.addEventListener('input', e => {
    const fieldEl = e.target.closest?.('[data-edit-field]');
    if (!fieldEl) return;
    const path = fieldEl.dataset.editField;
    const value = fieldEl.textContent.replace(/\s+/g, ' ').trim();
    if (path === 'recipient.name') syncGreeting(value);
    const autoTitle = titleIsAuto();
    setPath(doc, path, value);
    if (autoTitle && path.startsWith('recipient.')) syncTitle();
    const input = $(`.ed-form [data-path="${path}"]`, root);
    if (input) input.value = value;
    updateAround();
    save();
  });
  // The letter is named "Cover Letter - <company or recipient>" until the name is typed by hand.
  function titleIsAuto() {
    const t = (doc.title || '').trim();
    return doc.type === 'cover' && (!t || t === LETTER_TITLE || t === letterTitle(doc));
  }
  function syncTitle() {
    doc.title = letterTitle(doc) || LETTER_TITLE;
    const input = $('.title-input', root);
    if (input) input.value = doc.title;
  }
  // Keep "Dear …," in step with the recipient name unless the greeting was customised.
  function syncGreeting(newName) {
    const auto = !doc.greeting?.trim() || doc.greeting.trim() === greetingFor(doc.recipient.name.trim()) || doc.greeting.trim() === greetingFor('');
    if (!auto) return;
    doc.greeting = greetingFor(newName.trim());
    const g = $('[data-edit-field="greeting"]', live);
    if (g && document.activeElement !== g) g.textContent = doc.greeting;
    const gi = $('.ed-form [data-path="greeting"]', root);
    if (gi) gi.value = doc.greeting;
  }
  live.addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.closest?.('[data-edit-field]')) { e.preventDefault(); e.target.blur(); }
    const lines = e.target.closest?.('[data-edit-lines]');
    if (!lines) return;
    if (e.key === 'Enter' && lines.tagName !== 'UL') { e.preventDefault(); lines.blur(); } // a paragraph is one line; a list gets a new bullet
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') { e.preventDefault(); document.execCommand('bold'); }
  });
  // Bullet lists and paragraphs typed on the page (CV achievements and descriptions).
  live.addEventListener('input', e => {
    const lines = e.target.closest?.('[data-edit-lines]');
    if (!lines) return;
    const path = lines.dataset.editLines;
    const value = editableToLines(lines);
    setPath(doc, path, value);
    const input = $(`.ed-form [data-path="${path}"]`, root);
    if (input) input.value = value;
    updateAround();
    save();
  });
  live.addEventListener('paste', e => {
    if (!e.target.closest?.('[data-edit-lines]')) return;
    e.preventDefault(); // text only: never the source's fonts, colours or markup
    const text = e.clipboardData?.getData('text/plain') || '';
    if (text) document.execCommand('insertText', false, text);
  });
  root.addEventListener('click', e => {
    const opener = e.target.closest?.('[data-edit-open]');
    if (!opener) return;
    refresh();
    openField(opener.dataset.editOpen, opener.dataset.editFocus);
  });
  live.addEventListener('input', e => {
    const ed = e.target.closest?.('.l-edit');
    if (!ed) return;
    doc.body = editableToLetterText(ed);
    const ta = bodyBox();
    if (ta) ta.value = doc.body;
    updateAround();
    save();
  });
  live.addEventListener('paste', e => {
    const ed = e.target.closest?.('.l-edit');
    if (!ed) return;
    e.preventDefault(); // never insert the source's fonts and colours; keep only text, paragraphs and bold
    const html = e.clipboardData?.getData('text/html');
    const markup = (html && htmlToLetterText(html)) ?? (e.clipboardData?.getData('text/plain') || '');
    if (!markup.trim()) return;
    let frag = letterBlocks(markup);
    const single = /^<p>(?:(?!<p>)[\s\S])*<\/p>$/.test(frag);
    if (single) frag = frag.slice(3, -4); // one paragraph: insert inline instead of splitting the current one
    document.execCommand('insertHTML', false, frag);
  });
  live.addEventListener('focusout', e => {
    // Re-render once editing ends so the page shows exactly what will print.
    const edited = e.target.classList?.contains('l-edit') || e.target.dataset?.editField || e.target.dataset?.editLines;
    if (edited && !live.contains(e.relatedTarget)) refresh();
  });
  // Keep the selection in the page when pressing the toolbar buttons.
  root.addEventListener('mousedown', e => {
    if (e.target.closest('[data-act="fmt-bold"], [data-act="fmt-heading"]') && lastEditor?.classList?.contains('l-edit')) e.preventDefault();
  });
  root.addEventListener('change', e => {
    const role = e.target.dataset.role;
    if (role === 'template') { doc.templateId = e.target.value; renderSections(); }
    else if (role === 'size') doc.theme.size = e.target.value;
    else if (role === 'icons') doc.theme.icons = e.target.checked;
    else if (role === 'full-links') doc.theme.fullLinks = e.target.checked;
    else if (role === 'profile-heading') doc.theme.profileHeading = e.target.checked;
    else if (role === 'photo') { setPhoto(e.target.files?.[0]); return; }
    else if (role === 'import-into') { importInto(e.target); return; }
    else return;
    refresh();
    commit();
  });
  /** Fill this CV from an imported one: its content changes, its template, design, tags and section order stay. */
  const CONTENT = ['personal', 'summary', 'experience', 'education', 'skills', 'projects', 'certifications', 'languages', 'achievements', 'interests'];
  async function importInto(input) {
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    const ok = await confirmDialog(
      `Fill this CV with the content of “${file.name}”? Its template, colours, layout, tags and section order stay. You can undo this.`,
      'Import into this CV',
    );
    if (!ok) return;
    try {
      toast(`Reading ${file.name}…`, 8000);
      const imported = await fileToDoc(file);
      if (imported.type === 'cover') throw new Error('that is a cover letter; choose a CV');
      recordNow(); // so Undo brings back the content as it was
      const photo = doc.personal?.photo || '';
      for (const key of CONTENT) doc[key] = imported[key];
      if (!doc.personal.photo && photo) doc.personal.photo = photo; // a file without a photo keeps the current one
      rerenderForm();
      toast('Imported into this CV. Check each section: reading a CV is best-effort. Undo brings back the old content.', 6000);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 6000);
    }
  }
  async function setPhoto(file) {
    if (!file) return;
    try {
      doc.personal.photo = await fileToPhoto(file);
      rerenderForm();
      toast('Photo added');
    } catch (err) {
      toast(err.message);
    }
  }
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'panel') setPanel(b.dataset.panel, !panels[b.dataset.panel]);
    else if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'color' || act === 'font' || act === 'layout-reset') {
      if (act === 'color') doc.theme.color = b.dataset.color;
      else if (act === 'font') doc.theme.font = b.dataset.font;
      else Object.assign(doc.theme, { spacing: DEFAULT_SPACING, margin: DEFAULT_MARGIN, size: 'a4', icons: true, fullLinks: true, profileHeading: true });
      syncToolbar();
      refresh();
      commit();
    } else if (act === 'remove-photo') {
      doc.personal.photo = '';
      rerenderForm();
    } else if (act === 'add-item') {
      const list = b.dataset.list;
      const blank = {
        experience: { role: '', company: '', location: '', about: '', start: '', end: '', bullets: '' },
        achievements: { title: '', date: '', description: '' },
        education: { degree: '', school: '', location: '', start: '', end: '', details: '' },
        projects: { name: '', link: '', description: '' },
      }[list];
      const fromPage = live.contains(b) || !!b.closest('.add-sections'); // checked before the page is redrawn
      doc[list].push({ id: uid(), ...blank });
      rerenderForm();
      // Added from the page: start typing in the new entry straight away.
      if (fromPage) $(`[data-edit-field^="${list}.${doc[list].length - 1}."]`, live)?.focus();
    } else if (act === 'remove-item') {
      doc[b.dataset.list].splice(+b.dataset.i, 1);
      rerenderForm();
    } else if (act === 'move') {
      const arr = doc[b.dataset.list];
      const i = +b.dataset.i, j = i + +b.dataset.dir;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      rerenderForm();
    } else if (act === 'strengthen') {
      const e2 = doc.experience[+b.dataset.i];
      const before = e2.bullets;
      e2.bullets = splitLines(e2.bullets).map(strengthenBullet).join('\n');
      rerenderForm();
      toast(before === e2.bullets ? 'Bullets already look strong — try adding numbers.' : 'Rewrote weak openers. Review the wording!');
    } else if (act === 'draft') {
      const src = store.get($('[data-role="draft-src"]', root).value);
      (doc.body.trim() ? confirmDialog('Replace the current letter body with a new draft?', 'Replace') : Promise.resolve(true)).then(ok => {
        if (!ok) return;
        if (src && !doc.personal.name) doc.personal = { ...src.personal };
        doc.body = draftLetterBody(src, doc);
        rerenderForm();
        toast('Draft written. Personalise it before sending.');
      });
    } else if (act === 'fmt-bold' || act === 'fmt-heading') {
      const ed = pageEditor();
      if (ed && lastEditor === ed) (act === 'fmt-bold' ? editableBold : editableHeading)(ed);
      else if (bodyBox()) (act === 'fmt-bold' ? toggleBold : toggleHeading)(bodyBox());
    } else if (act === 'reset-personal') {
      doc.personal = { ...DEFAULT_PERSONAL, photo: doc.personal.photo || '' };
      rerenderForm();
      toast('Restored your default details');
    } else if (act === 'copy-personal') {
      const src = store.docs.find(d => d.type !== 'cover');
      if (src) { doc.personal = { ...src.personal }; rerenderForm(); toast(`Copied details from “${src.title}”`); }
    } else if (act === 'download') {
      downloadPdf(doc, b);
    } else if (act === 'export-json') {
      saveFile(`${(doc.title || 'document').replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(doc, null, 2));
    }
  });
  if (titleIsAuto() && letterTitle(doc) && doc.title !== letterTitle(doc)) { syncTitle(); commit(); }
  refresh();
}

/**
 * Download `doc` as a PDF, asking for the file name. A cover letter always goes out on one page: when
 * it spills over, the PDF is made from a copy with tighter spacing and margins (the document is unchanged).
 */
export async function downloadPdf(doc, btn) {
  const filename = await fileNameDialog(pdfName(doc), 'pdf');
  if (!filename) return;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Building PDF…'; }
  try {
    let target = doc;
    let note = '';
    if (doc.type === 'cover') {
      await document.fonts?.ready;
      const fit = fitOnePage(doc);
      target = fit.doc;
      if (fit.pages > 1) note = ` It still runs to ${fit.pages} pages: shorten the letter to fit one.`;
      else if (fit.changed) note = ' Spacing was tightened to keep it on one page.';
    }
    const { blob } = await buildPdf(target, $('#print-area'), { title: filename.replace(/\.pdf$/, '') });
    if (await saveFile(filename, blob)) toast(`Downloaded ${filename} (${Math.max(1, Math.round(blob.size / 1024))} KB).${note}`, note ? 6000 : 2600);
  } catch (err) {
    toast(`PDF failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
