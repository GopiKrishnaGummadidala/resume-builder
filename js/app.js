// Entry point: hash router, the list views (home, templates, documents) and app-wide actions.
import { blankResume, sampleResume, blankLetter, sampleLetter, normalizeDoc, uid } from './data.js';
import { store } from './store.js';
import { TEMPLATES, TEMPLATE_FILTERS, esc } from './templates.js';
import { fileToText, parseResumeText } from './importer.js';
import { $, $$, go, timeAgo, toast, confirmDialog } from './ui.js';
import { fitPages, miniPreview, pageObserver } from './preview.js';
import { editorPage, mountEditor } from './editor.js';
import { atsPage, mountAts, matchPage, mountMatch } from './tools.js';

const app = document.getElementById('app');

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
      <span class="pill">Free · No signup · Stays in your browser</span>
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
  const docs = store.docs;
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
      let parsed;
      try { parsed = JSON.parse(await f.text()); } catch { throw new Error('the file is not valid JSON'); }
      doc = normalizeDoc(parsed);
      if (!doc) throw new Error('this is not a Craftfolio export');
      doc.id = uid(); // imported copies never replace an existing document
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
  pageObserver.disconnect();
  app.innerHTML = html;
  document.body.classList.toggle('is-editor', view === 'edit');
  $$('.nav a').forEach(a => a.classList.toggle('active', !!h && a.getAttribute('href') === `#${view}`));
  mount();
  $$('.page-fit').forEach(el => pageObserver.observe(el));
  requestAnimationFrame(() => fitPages());
  if (view !== 'edit') window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// Another tab changed the documents: refresh lists; reload the editor only if its document changed.
store.subscribe(changed => {
  const editing = $('.editor')?.dataset.id;
  if (editing) {
    if (!changed.has(editing)) return;
    toast(store.get(editing) ? 'This document was changed in another tab. Showing the latest version.' : 'This document was deleted in another tab.');
  }
  route();
});
store.onError(() => toast('Could not save: browser storage is full or blocked. Use Export JSON to keep your work.', 6000));
document.fonts?.ready.then(() => fitPages());
route();
