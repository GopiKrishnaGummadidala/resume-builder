import { store, blankResume, sampleResume, blankLetter, sampleLetter, draftLetterBody, resumeToText, THEME_COLORS, FONTS, uid, splitLines, DEFAULT_PERSONAL } from './data.js';
import { TEMPLATES, TEMPLATE_FILTERS, renderDoc, renderResume, renderLetter, esc, letterBlocks } from './templates.js';
import { coachResume, coachLetter, atsCheck, matchJob, strengthenBullet } from './analysis.js';
import { fileToText, parseResumeText } from './importer.js';
import { htmlToLetterText, editableToLetterText, toggleBold, toggleHeading, editableBold, editableHeading } from './richtext.js';

const app = document.getElementById('app');
const PAGE_W = 794; // A4 at 96dpi
const PAGE_H = 1123;

// ---------- helpers ----------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const go = hash => { location.hash = hash; };
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const timeAgo = ts => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
};
function toast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
/** In-page confirmation (browser confirm() is unavailable when hosted). Resolves true/false. */
function confirmDialog(message, okLabel = 'Confirm', danger = false) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-msg">
      <p id="modal-msg">${esc(message)}</p>
      <div class="cta-row"><button class="btn btn-ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-r="1">${esc(okLabel)}</button></div>
    </div>`;
    const done = v => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
    const onKey = e => { if (e.key === 'Escape') done(false); };
    wrap.addEventListener('click', e => {
      const b = e.target.closest('[data-r]');
      if (b) done(b.dataset.r === '1');
      else if (e.target === wrap) done(false);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wrap.querySelector('[data-r="1"]').focus();
  });
}

const hosted = () => typeof window.claude?.use === 'function';

/** Save a generated file: via the host's downloads capability when hosted, else a normal browser download. */
async function saveFile(filename, data) {
  if (hosted()) {
    const downloads = await window.claude.use('downloads');
    if (!downloads) { toast('Saving files is not available in this view'); return false; }
    try { await downloads.save({ filename, data }); toast(`Saved ${filename}`); return true; }
    catch (err) { if (err?.code !== 'declined') toast(`Could not save: ${err?.message || err?.code || 'unknown error'}`); return false; }
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}

const loadScript = src => new Promise((res, rej) => {
  const s = document.createElement('script');
  s.src = src; s.onload = res; s.onerror = () => rej(new Error(`Could not load ${src}`));
  document.head.appendChild(s);
});

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach(k => (o = o[k]));
  o[keys[keys.length - 1]] = value;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }

/** Scale every .page inside `root` to fit its container width. */
function fitPages(root = document) {
  $$('.page-fit', root).forEach(box => {
    const page = $('.page', box);
    if (!page) return;
    const scale = Math.min(1, box.clientWidth / PAGE_W);
    page.style.transform = `scale(${scale})`;
    box.style.height = `${Math.max(page.scrollHeight, PAGE_H) * scale}px`;
  });
}
const ro = new ResizeObserver(() => fitPages());
window.addEventListener('resize', () => fitPages());

function miniPreview(doc) {
  return `<div class="page-fit mini">${renderDoc(doc)}</div>`;
}

function newDoc(type, templateId) {
  const doc = type === 'cover' ? blankLetter(templateId) : blankResume(templateId);
  store.add(doc);
  go(`#edit-${doc.id}`);
}

// ---------- pages ----------
function homePage() {
  const sample = sampleResume();
  const shows = ['classic', 'modern', 'tech'].map(id => ({ ...sample, templateId: id, theme: { ...sample.theme, color: { classic: '#2563eb', modern: '#0f766e', tech: '#7c3aed' }[id] } }));
  return `
  <section class="hero">
    <div class="hero-copy">
      <span class="pill">Free · No signup · Works offline</span>
      <h1>Build a job-winning <span class="grad">CV & cover letter</span> in minutes</h1>
      <p class="lead">Pick an ATS-friendly template, fill in your details with a built-in coach looking over your shoulder, and download a pixel-perfect PDF. Your data never leaves your browser.</p>
      <div class="cta-row">
        <button class="btn btn-primary btn-lg" data-act="new-resume">Create my CV</button>
        <button class="btn btn-ghost btn-lg" data-act="new-cover">Write a cover letter</button>
      </div>
      <label class="import-link">or <span class="link">import an existing CV (PDF, TXT)</span><input type="file" accept=".pdf,.txt,.json" data-act="import" hidden></label>
    </div>
    <div class="hero-art">
      <div class="stack">${shows.map((d, i) => `<div class="stack-card s${i}">${miniPreview(d)}</div>`).join('')}</div>
    </div>
  </section>

  <section class="band">
    <div class="feature-grid">
      ${[
        ['📄', 'ATS-friendly by design', 'Clean structure, standard headings and real selectable text that applicant tracking systems can read.'],
        ['🧭', 'Coach built into the editor', 'Live score and tips: action verbs, measurable results, bullet counts, length and consistency.'],
        ['✉️', 'Matching cover letters', 'Letters share your CV design and can be drafted from your CV in one click.'],
        ['🎯', 'Tailor every application', 'Duplicate a CV per job and check it against the job ad with the Job Matcher.'],
      ].map(([i, t, d]) => `<div class="feature"><div class="f-icon">${i}</div><h3>${t}</h3><p>${d}</p></div>`).join('')}
    </div>
  </section>

  <section class="section">
    <h2 class="center">How it works</h2>
    <div class="steps">
      <div class="step"><b>1</b><h3>Start your way</h3><p>Choose a template or import your old CV and rebuild it in a clean design.</p></div>
      <div class="step"><b>2</b><h3>Polish with the coach</h3><p>Fix weak bullets, quantify wins and fill gaps flagged in real time.</p></div>
      <div class="step"><b>3</b><h3>Download & apply</h3><p>Export a crisp PDF and a matching cover letter. No paywall, no watermark.</p></div>
    </div>
  </section>

  <section class="section">
    <div class="section-head"><h2>Templates for every career path</h2><a class="btn btn-ghost" href="#templates">Browse all templates →</a></div>
    <div class="tpl-grid">
      ${TEMPLATES.slice(0, 3).map(t => templateCard(t, 'resume')).join('')}
    </div>
  </section>

  <section class="section">
    <h2 class="center">More than a CV maker</h2>
    <div class="tool-grid">
      <a class="tool" href="#documents"><span class="tag">BUILD</span><h3>CV Builder</h3><p>Live preview, 6 templates, 8 colours, 4 fonts.</p></a>
      <a class="tool" href="#templates-cover"><span class="tag">APPLY</span><h3>Cover Letter Builder</h3><p>Matching designs and a one-click draft from your CV.</p></a>
      <a class="tool" href="#ats"><span class="tag">CHECK</span><h3>ATS Checker</h3><p>Upload a PDF or paste text for a compatibility score and fixes.</p></a>
      <a class="tool" href="#match"><span class="tag">MATCH</span><h3>Job Matcher</h3><p>See which keywords from the job ad you hit, nearly hit, or miss.</p></a>
    </div>
  </section>

  <section class="cta-band">
    <h2>Ready to land your next interview?</h2>
    <button class="btn btn-light btn-lg" data-act="new-resume">Create my CV — it's free</button>
  </section>`;
}

function templateCard(t, type) {
  const base = type === 'cover' ? sampleLetter() : sampleResume();
  const doc = { ...base, templateId: t.id };
  return `<div class="tpl-card">
    <div class="tpl-thumb">${miniPreview(doc)}
      <div class="tpl-hover"><button class="btn btn-primary" data-act="use-template" data-type="${type}" data-tpl="${t.id}">Use this template</button></div>
    </div>
    <div class="tpl-meta"><h3>${esc(t.name)}</h3>${t.tags.includes('ats') ? '<span class="badge">ATS</span>' : ''}<p>${esc(t.desc)}</p></div>
  </div>`;
}

let tplFilter = 'all';

function templatesPage(type) {
  const filter = tplFilter;
  const list = TEMPLATES.filter(t => filter === 'all' || t.tags.includes(filter));
  return `<section class="section">
    <h1>${type === 'cover' ? 'Cover letter' : 'CV'} templates</h1>
    <p class="lead">Every template is ready to edit. Cover letters match your CV design so your application looks like a set.</p>
    <div class="tabs">
      <a class="tab ${type === 'resume' ? 'active' : ''}" href="#templates">CV / Resume</a>
      <a class="tab ${type === 'cover' ? 'active' : ''}" href="#templates-cover">Cover letter</a>
    </div>
    <div class="chips">${TEMPLATE_FILTERS.map(f => `<button class="chip ${f.id === filter ? 'active' : ''}" data-act="filter" data-filter="${f.id}">${f.label}</button>`).join('')}</div>
    <div class="tpl-grid">${list.map(t => templateCard(t, type)).join('') || '<p>No templates match.</p>'}</div>
  </section>`;
}

function documentsPage() {
  const docs = store.state.docs;
  const card = d => `<div class="doc-card">
    <a class="doc-thumb" href="#edit-${d.id}">${miniPreview(d)}</a>
    <div class="doc-meta">
      <span class="badge ${d.type === 'cover' ? 'badge-alt' : ''}">${d.type === 'cover' ? 'Cover letter' : 'CV'}</span>
      <h3 title="${esc(d.title)}">${esc(d.title)}</h3>
      <p class="muted">Edited ${timeAgo(d.updatedAt)}</p>
      <div class="doc-actions">
        <a class="btn btn-sm btn-primary" href="#edit-${d.id}">Edit</a>
        <button class="btn btn-sm btn-ghost" data-act="dup" data-id="${d.id}" title="Duplicate to tailor for another job">Duplicate</button>
        ${d.type !== 'cover' ? `<button class="btn btn-sm btn-ghost" data-act="letter-from" data-id="${d.id}">+ Letter</button>` : ''}
        <button class="btn btn-sm btn-danger" data-act="del" data-id="${d.id}">Delete</button>
      </div>
    </div>
  </div>`;
  return `<section class="section">
    <div class="section-head">
      <h1>My documents</h1>
      <div class="cta-row">
        <button class="btn btn-primary" data-act="new-resume">+ New CV</button>
        <button class="btn btn-ghost" data-act="new-cover">+ New cover letter</button>
        <label class="btn btn-ghost">Import CV<input type="file" accept=".pdf,.txt,.json" data-act="import" hidden></label>
      </div>
    </div>
    ${docs.length ? `<div class="doc-grid">${docs.map(card).join('')}</div>` : `
      <div class="empty">
        <h3>No documents yet</h3>
        <p>Start from scratch, import an existing CV, or explore with sample content.</p>
        <div class="cta-row center">
          <button class="btn btn-primary" data-act="new-resume">Create a CV</button>
          <button class="btn btn-ghost" data-act="samples">Load samples</button>
        </div>
      </div>`}
    <p class="muted small">Documents are saved automatically in this browser (localStorage). Use “Export JSON” in the editor to back them up.</p>
  </section>`;
}

// ---------- editor ----------
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
  return `${reset}<div class="grid2">
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
      ${field('Start', `experience.${i}.start`, r, { ph: '2021' })}
      ${field('End', `experience.${i}.end`, r, { ph: 'Present' })}
      ${field('Location', `experience.${i}.location`, r, { full: true })}
      ${field('Achievements (one per line)', `experience.${i}.bullets`, r, { textarea: true, rows: 5, full: true, ph: 'Led redesign of onboarding, increasing activation by 23%', hint: '3–6 bullets. Start with an action verb and add a number where you can.' })}
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
  return [
    group('Personal details', 'personal', personalFields(r)),
    group('Professional summary', 'summary', field('Summary', 'summary', r, { textarea: true, rows: 4, full: true, ph: '2–4 sentences: who you are, your strongest results, what you want next.' })),
    group('Work experience', 'experience', `${exp}<button class="btn btn-dashed" data-act="add-item" data-list="experience">+ Add position</button>`),
    group('Education', 'education', `${edu}<button class="btn btn-dashed" data-act="add-item" data-list="education">+ Add education</button>`),
    group('Skills', 'skills', field('Skills (comma separated)', 'skills', r, { textarea: true, rows: 3, full: true, ph: 'Figma, SQL, Stakeholder management…' })),
    group('Projects', 'projects', `${proj}<button class="btn btn-dashed" data-act="add-item" data-list="projects">+ Add project</button>`, r.projects.length > 0),
    group('Certifications & languages', 'extra', `<div class="grid2">
      ${field('Certifications (comma separated)', 'certifications', r, { textarea: true, rows: 2, full: true })}
      ${field('Languages (comma separated)', 'languages', r, { textarea: true, rows: 2, full: true })}</div>`, !!(r.certifications || r.languages)),
  ].join('');
}

function letterForm(l) {
  const resumes = store.state.docs.filter(d => d.type !== 'cover');
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

function editorPage(id) {
  const doc = store.get(id);
  if (!doc) return `<section class="section"><h1>Document not found</h1><a class="btn btn-primary" href="#documents">Back to my documents</a></section>`;
  doc.type = doc.type || 'resume';
  return `<div class="editor" data-id="${doc.id}">
    <div class="ed-toolbar no-print">
      <a class="btn btn-sm btn-ghost" href="#documents">← Documents</a>
      <input class="title-input" data-path="title" value="${esc(doc.title)}" aria-label="Document name">
      <div class="tb-group">
        <select data-role="template" aria-label="Template">${TEMPLATES.map(t => `<option value="${t.id}" ${t.id === doc.templateId ? 'selected' : ''}>${t.name}</option>`).join('')}</select>
        <select data-role="font" aria-label="Font">${FONTS.map(f => `<option value="${f.id}" ${f.id === doc.theme.font ? 'selected' : ''}>${f.label}</option>`).join('')}</select>
        <div class="swatches">${THEME_COLORS.map(c => `<button class="swatch ${c === doc.theme.color ? 'active' : ''}" style="--c:${c}" data-act="color" data-color="${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      </div>
      <div class="tb-group">
        <button class="btn btn-sm btn-ghost" data-act="export-json">Export JSON</button>
        ${doc.type !== 'cover' ? `<a class="btn btn-sm btn-ghost" href="#match-${doc.id}">Match to job</a>` : ''}
        <button class="btn btn-sm btn-primary" data-act="download">⬇ Download PDF</button>
      </div>
    </div>
    <div class="ed-body">
      <div class="ed-form no-print">${doc.type === 'cover' ? letterForm(doc) : resumeForm(doc)}</div>
      <div class="ed-preview">
        ${doc.type === 'cover' ? '<p class="edit-tip no-print">Click the letter text below to edit it directly. Ctrl+B for bold.</p>' : ''}
        <div class="page-fit" id="live">${renderDoc(doc, { editable: true })}</div>
        <p class="overflow-warn" hidden>Content runs past one page — it will continue on page 2 in the PDF.</p>
      </div>
      <aside class="ed-coach no-print" id="coach">${coachPanel(doc)}</aside>
    </div>
  </div>`;
}

function mountEditor() {
  const root = $('.editor');
  if (!root) return;
  const doc = store.get(root.dataset.id);
  const live = $('#live');
  ro.observe(live);

  // Size, overflow warning and coach — everything except re-rendering the page itself.
  const updateAround = () => {
    fitPages(root);
    const page = $('.page', live);
    $('.overflow-warn', root).hidden = page.scrollHeight <= PAGE_H + 2;
    $('#coach').innerHTML = coachPanel(doc);
  };
  const refresh = () => {
    live.innerHTML = renderDoc(doc, { editable: true });
    updateAround();
  };
  const save = debounce(() => store.update(doc), 300);
  const rerenderForm = () => {
    const open = new Set($$('.group[open]', root).map(g => g.dataset.group));
    $('.ed-form', root).innerHTML = doc.type === 'cover' ? letterForm(doc) : resumeForm(doc);
    $$('.group', root).forEach(g => (g.open = open.has(g.dataset.group)));
    refresh();
    store.update(doc);
  };

  root.addEventListener('input', e => {
    const path = e.target.dataset.path;
    if (!path) return;
    setPath(doc, path, e.target.value);
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
    if (e.target === bodyBox()) lastEditor = e.target;
    else if (e.target.classList?.contains('l-edit')) {
      lastEditor = e.target;
      document.execCommand('defaultParagraphSeparator', false, 'p');
    }
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
    if (e.target.classList?.contains('l-edit') && !live.contains(e.relatedTarget)) refresh();
  });
  // Keep the selection in the page when pressing the toolbar buttons.
  root.addEventListener('mousedown', e => {
    if (e.target.closest('[data-act="fmt-bold"], [data-act="fmt-heading"]') && lastEditor?.classList?.contains('l-edit')) e.preventDefault();
  });
  root.addEventListener('change', e => {
    const role = e.target.dataset.role;
    if (role === 'template') doc.templateId = e.target.value;
    else if (role === 'font') doc.theme.font = e.target.value;
    else return;
    refresh();
    store.update(doc);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'color') {
      doc.theme.color = b.dataset.color;
      $$('.swatch', root).forEach(s => s.classList.toggle('active', s === b));
      refresh(); store.update(doc);
    } else if (act === 'add-item') {
      const list = b.dataset.list;
      const blank = {
        experience: { role: '', company: '', location: '', start: '', end: '', bullets: '' },
        education: { degree: '', school: '', location: '', start: '', end: '', details: '' },
        projects: { name: '', link: '', description: '' },
      }[list];
      doc[list].push({ id: uid(), ...blank });
      rerenderForm();
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
      doc.personal = { ...DEFAULT_PERSONAL };
      rerenderForm();
      toast('Restored your default details');
    } else if (act === 'copy-personal') {
      const src = store.state.docs.find(d => d.type !== 'cover');
      if (src) { doc.personal = { ...src.personal }; rerenderForm(); toast(`Copied details from “${src.title}”`); }
    } else if (act === 'download') {
      downloadPdf(doc, b);
    } else if (act === 'export-json') {
      saveFile(`${(doc.title || 'document').replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(doc, null, 2));
    }
  });
  refresh();
}

const pdfName = doc => (doc.personal.name ? `${doc.personal.name} ${doc.type === 'cover' ? 'Cover Letter' : 'CV'}` : doc.title).replace(/[^\w\s-]+/g, '').trim() || 'document';

async function downloadPdf(doc, btn) {
  const area = $('#print-area');
  area.innerHTML = renderDoc(doc);
  if (!hosted()) {
    // Local: the browser's own print-to-PDF keeps text selectable.
    const prevTitle = document.title;
    document.title = pdfName(doc);
    toast('In the print dialog choose “Save as PDF”');
    setTimeout(() => { window.print(); document.title = prevTitle; }, 50);
    return;
  }
  // Hosted: printing is blocked, so render the page to a PDF in the browser.
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Building PDF…'; }
  try {
    if (!window.html2canvas) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
    if (!window.jspdf) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    area.classList.add('rendering');
    await document.fonts.ready;
    const page = $('.page', area);
    const fullH = Math.max(page.scrollHeight, PAGE_H);
    const canvas = await window.html2canvas(page, {
      scale: 2, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0,
      width: PAGE_W, height: fullH, windowWidth: PAGE_W, windowHeight: fullH, // capture the whole page, not just the visible frame
    });
    const pdf = new window.jspdf.jsPDF({ unit: 'pt', format: 'a4' });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const sliceH = Math.floor(canvas.width * (ph / pw)); // canvas px per PDF page
    for (let y = 0, n = 0; y < canvas.height - 4; y += sliceH, n++) {
      const part = document.createElement('canvas');
      part.width = canvas.width;
      part.height = Math.min(sliceH, canvas.height - y);
      part.getContext('2d').drawImage(canvas, 0, y, canvas.width, part.height, 0, 0, canvas.width, part.height);
      if (n) pdf.addPage();
      pdf.addImage(part.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, part.height * (pw / canvas.width));
    }
    await saveFile(`${pdfName(doc)}.pdf`, pdf.output('blob'));
  } catch (err) {
    toast(`PDF failed: ${err.message}`);
  } finally {
    area.classList.remove('rendering');
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

// ---------- tools ----------
function atsPage() {
  const resumes = store.state.docs.filter(d => d.type !== 'cover');
  return `<section class="section narrow">
    <span class="tag">CHECK</span>
    <h1>ATS Resume Checker</h1>
    <p class="lead">Upload a PDF or paste your CV text to see how well applicant tracking systems can read it — and what to fix.</p>
    <div class="tool-input">
      <div class="cta-row">
        <label class="btn btn-ghost">Upload PDF / TXT<input type="file" accept=".pdf,.txt" data-role="ats-file" hidden></label>
        ${resumes.length ? `<select data-role="ats-doc"><option value="">…or use a saved CV</option>${resumes.map(r => `<option value="${r.id}">${esc(r.title)}</option>`).join('')}</select>` : ''}
      </div>
      <textarea data-role="ats-text" rows="12" placeholder="Paste your CV text here…"></textarea>
      <button class="btn btn-primary" data-act="ats-run">Check my CV</button>
    </div>
    <div id="ats-result"></div>
  </section>`;
}

function mountAts() {
  const ta = $('[data-role="ats-text"]');
  if (!ta) return;
  const run = () => {
    const res = atsCheck(ta.value);
    const level = res.score >= 80 ? 'good' : res.score >= 55 ? 'ok' : 'low';
    $('#ats-result').innerHTML = ta.value.trim() ? `<div class="result-card">
      <div class="score score-${level}"><div class="ring" style="--p:${res.score}"><span>${res.score}</span></div>
        <div><strong>ATS compatibility</strong><p class="muted small">${res.wordCount} words analysed</p></div></div>
      <div class="result-groups">${res.groups.map(g => `<div><h3>${g.name}</h3><ul class="checks">${g.items.map(([ok, txt]) => `<li class="${ok ? 'done' : 'todo'}">${esc(txt)}</li>`).join('')}</ul></div>`).join('')}</div>
      <div class="cta-row"><button class="btn btn-primary" data-act="rebuild">Rebuild this CV in an ATS template</button></div>
    </div>` : '<p class="muted">Paste or upload a CV first.</p>';
  };
  $('[data-act="ats-run"]').addEventListener('click', run);
  $('[data-role="ats-file"]').addEventListener('change', async e => {
    const f = e.target.files[0];
    if (!f) return;
    try { ta.value = await fileToText(f); run(); } catch (err) { toast(err.message); }
  });
  $('[data-role="ats-doc"]')?.addEventListener('change', e => {
    const d = store.get(e.target.value);
    if (d) { ta.value = resumeToText(d); run(); }
  });
  $('#ats-result').addEventListener('click', e => {
    if (e.target.closest('[data-act="rebuild"]')) {
      const doc = store.add(parseResumeText(ta.value));
      go(`#edit-${doc.id}`);
    }
  });
}

function matchPage(pre) {
  const resumes = store.state.docs.filter(d => d.type !== 'cover');
  return `<section class="section narrow">
    <span class="tag">MATCH</span>
    <h1>Resume Job Matcher</h1>
    <p class="lead">Paste a job ad and see which of its keywords your CV covers, nearly covers, or is missing.</p>
    <div class="match-grid">
      <label class="field"><span>Your CV</span>
        ${resumes.length ? `<select data-role="m-doc"><option value="">Paste text instead</option>${resumes.map(r => `<option value="${r.id}" ${r.id === pre ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>` : ''}
        <textarea data-role="m-cv" rows="12" placeholder="Paste your CV text…"></textarea></label>
      <label class="field"><span>Job description</span><textarea data-role="m-jd" rows="14" placeholder="Paste the full job ad…"></textarea></label>
    </div>
    <button class="btn btn-primary" data-act="m-run">Compare</button>
    <div id="m-result"></div>
  </section>`;
}

function mountMatch() {
  const cv = $('[data-role="m-cv"]');
  if (!cv) return;
  const sel = $('[data-role="m-doc"]');
  const syncCv = () => {
    const d = sel && store.get(sel.value);
    cv.value = d ? resumeToText(d) : cv.value;
    cv.readOnly = !!d;
  };
  sel?.addEventListener('change', syncCv);
  syncCv();
  $('[data-act="m-run"]').addEventListener('click', () => {
    const jd = $('[data-role="m-jd"]').value;
    if (!jd.trim() || !cv.value.trim()) { toast('Add both your CV and the job description'); return; }
    const r = matchJob(cv.value, jd);
    const chip = (k, cls) => `<span class="kw ${cls}">${esc(k.term)}</span>`;
    const level = r.score >= 70 ? 'good' : r.score >= 45 ? 'ok' : 'low';
    $('#m-result').innerHTML = `<div class="result-card">
      <div class="score score-${level}"><div class="ring" style="--p:${r.score}"><span>${r.score}</span></div>
        <div><strong>Keyword match</strong><p class="muted small">Weighted by how often each term appears in the ad</p></div></div>
      <h3>✅ Matched (${r.matched.length})</h3><div class="kw-wrap">${r.matched.map(k => chip(k, 'ok')).join('') || '<span class="muted">None yet</span>'}</div>
      <h3>🟡 Close (${r.partial.length})</h3><p class="muted small">A related form of the word appears — consider using the exact wording from the ad.</p><div class="kw-wrap">${r.partial.map(k => chip(k, 'mid')).join('') || '<span class="muted">—</span>'}</div>
      <h3>❌ Missing (${r.missing.length})</h3><p class="muted small">Add the ones you genuinely have to your skills or bullets.</p><div class="kw-wrap">${r.missing.map(k => chip(k, 'bad')).join('') || '<span class="muted">—</span>'}</div>
      ${sel?.value ? `<div class="cta-row"><a class="btn btn-primary" href="#edit-${sel.value}">Edit this CV</a><button class="btn btn-ghost" data-act="tailor" data-id="${sel.value}">Duplicate & tailor</button></div>` : ''}
    </div>`;
  });
  $('#m-result').addEventListener('click', e => {
    const b = e.target.closest('[data-act="tailor"]');
    if (b) { const d = store.duplicate(b.dataset.id); go(`#edit-${d.id}`); }
  });
}

// ---------- global actions ----------
document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.closest('.editor')) return;
  const act = b.dataset.act;
  if (act === 'new-resume') newDoc('resume');
  else if (act === 'new-cover') newDoc('cover');
  else if (act === 'use-template') newDoc(b.dataset.type, b.dataset.tpl);
  else if (act === 'samples') { store.add(sampleLetter()); store.add(sampleResume()); route(); }
  else if (act === 'dup') { store.duplicate(b.dataset.id); toast('Duplicated — rename it for the new job'); route(); }
  else if (act === 'filter') { tplFilter = b.dataset.filter; route(); }
  else if (act === 'del') {
    const d = store.get(b.dataset.id);
    confirmDialog(`Delete “${d?.title || 'this document'}”? This cannot be undone.`, 'Delete', true).then(ok => { if (ok) { store.remove(b.dataset.id); route(); } });
  }
  else if (act === 'letter-from') {
    const r = store.get(b.dataset.id);
    const l = blankLetter(r.templateId, r);
    l.title = `Cover letter — ${r.personal.name || r.title}`;
    store.add(l);
    go(`#edit-${l.id}`);
  }
});

document.addEventListener('change', async e => {
  if (e.target.dataset.act !== 'import') return;
  const f = e.target.files[0];
  if (!f) return;
  try {
    let doc;
    if (/\.json$/i.test(f.name)) {
      doc = JSON.parse(await f.text());
      if (!doc.personal || !doc.theme) throw new Error('Not a Craftfolio export');
      doc.id = uid();
    } else {
      doc = parseResumeText(await fileToText(f));
    }
    store.add(doc);
    toast('Imported — check each section, automatic parsing is best-effort');
    go(`#edit-${doc.id}`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

// ---------- router ----------
// Views are plain hash names (#templates, #edit-<id>, #match-<id>) so links work when hosted.
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [view, ...rest] = h.split('-');
  const arg = rest.join('-');
  let html;
  let mount = () => {};
  if (!h) html = homePage();
  else if (view === 'templates') html = templatesPage(arg === 'cover' ? 'cover' : 'resume');
  else if (view === 'documents') html = documentsPage();
  else if (view === 'edit') { html = editorPage(arg); mount = mountEditor; }
  else if (view === 'ats') { html = atsPage(); mount = mountAts; }
  else if (view === 'match') { html = matchPage(arg); mount = mountMatch; }
  else html = `<section class="section"><h1>Page not found</h1><a class="btn btn-primary" href="#">Home</a></section>`;
  ro.disconnect();
  app.innerHTML = html;
  document.body.classList.toggle('is-editor', view === 'edit');
  $$('.nav a').forEach(a => a.classList.toggle('active', !!h && a.getAttribute('href') === `#${view}`));
  mount();
  $$('.page-fit').forEach(el => ro.observe(el));
  requestAnimationFrame(() => fitPages());
  if (view !== 'edit') window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
document.fonts?.ready.then(() => fitPages());
route();
