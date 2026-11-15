// Entry point: hash router, the list views (home, templates, documents) and app-wide actions.
import { blankResume, sampleResume, blankLetter, sampleLetter } from './data.js';
import { store, browserBackend, accountKey, parseState, STORAGE_KEY } from './store.js';
import { api, createSync } from './account.js';
import { TEMPLATES, TEMPLATE_FILTERS, esc } from './templates.js';
import { fileToDoc } from './importer.js';
import { $, $$, go, timeAgo, toast, confirmDialog } from './ui.js';
import { fitPages, miniPreview, pageObserver } from './preview.js';
import { editorPage, mountEditor } from './editor.js';
import { atsPage, mountAts, matchPage, mountMatch } from './tools.js';
import { tailorPage, mountTailor } from './tailorpage.js';

const app = document.getElementById('app');

// ---------- accounts ----------
// available: the app is served with the API (server/). user: who is signed in. Without the API, or
// signed out, documents stay in this browser as before.
const account = { available: false, user: null, sync: null, status: '', expired: false };
const STATUS_TEXT = {
  saving: 'Saving to your account…',
  saved: 'All changes are saved to your account.',
  offline: 'Offline: changes are kept in this browser and sent when the server can be reached.',
  'signed-out': 'Your session ended. Sign in again to keep saving to your account.',
};

function renderAccount() {
  const slot = $('#nav-account');
  const note = $('#storage-note');
  if (note) {
    note.textContent = account.user
      ? 'Signed in: your documents are saved to your account.'
      : 'Your documents are stored only in this browser.';
  }
  if (!slot) return;
  if (!account.available) { slot.innerHTML = ''; return; }
  if (!account.user) { slot.innerHTML = '<a href="#login" class="btn btn-sm btn-ghost">Sign in</a>'; return; }
  const email = esc(account.user.email);
  slot.innerHTML = `<details class="acct-menu">
      <summary class="btn btn-sm btn-ghost" title="Signed in as ${email}"><span class="acct-avatar" aria-hidden="true">${esc(account.user.email[0].toUpperCase())}</span><span class="acct-email">${email}</span></summary>
      <div class="acct-pop">
        <p class="muted small">Signed in as</p>
        <p class="acct-who">${email}</p>
        <p class="acct-status small" role="status">${esc(STATUS_TEXT[account.status] || '')}</p>
        ${account.expired ? '<a class="btn btn-sm btn-primary" href="#login">Sign in again</a>' : ''}
        <button type="button" class="btn btn-sm btn-ghost" data-act="sign-out">Sign out</button>
      </div>
    </details>`;
}

function setStatus(status) {
  const was = account.status;
  account.status = status;
  if (status === 'signed-out' && !account.expired) {
    account.expired = true;
    toast(STATUS_TEXT['signed-out'], 6000);
    renderAccount();
    return;
  }
  if (status === 'offline' && was !== 'offline') toast(STATUS_TEXT.offline, 5000);
  const el = $('.acct-status');
  if (el) el.textContent = STATUS_TEXT[status] || '';
}

/** Use the account's documents: its working copy in this browser, kept in step with the server. */
async function useAccount(user) {
  account.sync?.stop();
  account.user = user;
  account.expired = false;
  store.use(browserBackend(accountKey(user.id)));
  account.sync = createSync(store, setStatus);
  renderAccount();
  await account.sync.start();
}

/** Documents made in this browser without an account: offer to move them into the account. */
async function offerGuestDocuments() {
  let raw = null;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch { /* storage blocked */ }
  const guest = parseState(raw);
  const n = guest.docs.length;
  if (!n) return;
  const ok = await confirmDialog(
    `This browser has ${n} document${n === 1 ? '' : 's'} made without an account. Move ${n === 1 ? 'it' : 'them'} into your account?`,
    'Move to my account',
  );
  if (!ok) return;
  store.mergeRemote({ docs: guest.docs, deleted: {} });
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* storage blocked */ }
  toast(`Moved ${n} document${n === 1 ? '' : 's'} into your account`);
}

async function signOut() {
  if (account.sync) {
    await account.sync.flush();
    if (account.status !== 'saved') {
      const leave = await confirmDialog('Some changes have not reached your account yet (offline or signed out). If you sign out now they are lost. Sign out anyway?', 'Sign out anyway', true);
      if (!leave) return;
    }
  }
  try { await api.logout(); } catch { /* the session is dropped below either way */ }
  account.sync?.stop();
  account.sync = null;
  const key = store.key;
  store.use(browserBackend());
  // The account's working copy is removed, so the next person on this computer cannot see it.
  try { localStorage.removeItem(key); } catch { /* storage blocked */ }
  account.user = null;
  account.status = '';
  account.expired = false;
  renderAccount();
  toast('Signed out. Your documents are safe in your account.');
  go('#');
  route();
}

function authPage(mode) {
  const signup = mode === 'signup';
  if (!account.available) {
    return `<section class="section auth"><div class="auth-card">
      <h1>Accounts are not set up here</h1>
      <p class="muted">This copy of Craftfolio runs without its server, so documents are kept in this browser only.</p>
      <a class="btn btn-primary" href="#documents">Go to my documents</a></div></section>`;
  }
  if (account.user && !account.expired) {
    return `<section class="section auth"><div class="auth-card">
      <h1>You are signed in</h1><p class="muted">as ${esc(account.user.email)}</p>
      <a class="btn btn-primary" href="#documents">Go to my documents</a></div></section>`;
  }
  return `<section class="section auth"><div class="auth-card">
    <h1>${signup ? 'Create your account' : 'Sign in'}</h1>
    <p class="muted">${signup
      ? 'Keep your CVs and cover letters in your account and open them on any device.'
      : 'Welcome back. Your documents are waiting in your account.'}</p>
    <form class="auth-form" data-auth="${signup ? 'signup' : 'login'}" novalidate>
      <label>Email<input type="email" name="email" autocomplete="${signup ? 'email' : 'username'}" required maxlength="254" value="${esc(account.expired ? account.user?.email || '' : '')}"></label>
      <label>Password<input type="password" name="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="${signup ? 10 : 1}" maxlength="200"></label>
      ${signup ? '<p class="muted small auth-hint">At least 10 characters. A short sentence is easy to remember and hard to guess.</p>' : ''}
      <p class="auth-error" role="alert" hidden></p>
      <button class="btn btn-primary" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="muted small">${signup ? 'Already have an account? <a href="#login">Sign in</a>' : 'New here? <a href="#signup">Create an account</a>'}</p>
    <p class="muted small">Or <a href="#documents">keep using Craftfolio without an account</a>: your documents then stay in this browser.</p>
  </div></section>`;
}

document.addEventListener('submit', async e => {
  const form = e.target.closest('form[data-auth]');
  if (!form) return;
  e.preventDefault();
  const signup = form.dataset.auth === 'signup';
  const email = form.email.value.trim();
  const password = form.password.value;
  const error = $('.auth-error', form);
  const button = $('button[type="submit"]', form);
  const fail = msg => { error.textContent = msg; error.hidden = false; };
  if (!email || !password) { fail('Enter your email and password.'); return; }
  if (signup && password.length < 10) { fail('Use at least 10 characters for the password.'); return; }
  error.hidden = true;
  button.disabled = true;
  try {
    const user = await (signup ? api.register(email, password) : api.login(email, password));
    await useAccount(user);
    toast(signup ? 'Account created. Your documents are now saved to it.' : 'Signed in');
    await offerGuestDocuments();
    go('#documents');
  } catch (err) {
    fail(err.message);
  } finally {
    button.disabled = false;
  }
});

// The account menu and card menus close when clicking elsewhere (or on one of their items).
document.addEventListener('click', e => {
  for (const menu of document.querySelectorAll('.acct-menu[open], .doc-more[open]')) {
    if (!menu.contains(e.target) || (menu.classList.contains('doc-more') && e.target.closest('.doc-more-pop button'))) menu.open = false;
  }
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') document.querySelectorAll('.acct-menu[open], .doc-more[open]').forEach(m => { m.open = false; });
});

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
      <div class="tpl-hover"><button class="btn btn-primary" data-act="use-template" data-type="${type}" data-tpl="${t.id}">Use this template</button>
        ${type === 'cover' ? '' : `<label class="btn btn-ghost tpl-import" title="Open your existing CV (PDF, text or Craftfolio JSON) in the ${esc(t.name)} template">Import my CV<input type="file" accept=".pdf,.txt,.json" data-act="import" data-tpl="${t.id}" hidden></label>`}</div>
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
    ${type === 'cover' ? '' : `<div class="tpl-import-bar">
      <p><strong>Already have a CV?</strong> Point at a template and choose <em>Import my CV</em>: your CV opens in that design. Or import it now and pick the template later.</p>
      <label class="btn btn-sm btn-ghost">Import my CV<input type="file" accept=".pdf,.txt,.json" data-act="import" hidden></label>
    </div>`}
    <div class="chips">${TEMPLATE_FILTERS.map(f => `<button class="chip ${f.id === filter ? 'active' : ''}" data-act="filter" data-filter="${f.id}">${f.label}</button>`).join('')}</div>
    <div class="tpl-grid">${list.map(t => templateCard(t, type)).join('') || '<p>No templates match.</p>'}</div>
  </section>`;
}

let docTag = ''; // the tag My documents is filtered by ('' = all)

function documentsPage() {
  const all = store.docs;
  const tags = [...new Set(all.flatMap(d => d.tags || []))].sort((a, b) => a.localeCompare(b));
  if (docTag && !tags.includes(docTag)) docTag = '';
  const docs = docTag ? all.filter(d => (d.tags || []).includes(docTag)) : all;
  const count = t => all.filter(d => (d.tags || []).includes(t)).length;
  const tagBar = tags.length
    ? `<div class="chips doc-filter" role="group" aria-label="Filter by tag">
        <button class="chip ${docTag ? '' : 'active'}" data-act="doc-tag" data-tag="" aria-pressed="${!docTag}">All <span class="chip-n">${all.length}</span></button>
        ${tags.map(t => `<button class="chip ${t === docTag ? 'active' : ''}" data-act="doc-tag" data-tag="${esc(t)}" aria-pressed="${t === docTag}">${esc(t)} <span class="chip-n">${count(t)}</span></button>`).join('')}
      </div>`
    : '';
  // The CV a cover letter goes with: the one sharing most of its tags (Tailor tags both alike), else the newest.
  const resumes = all.filter(d => d.type !== 'cover');
  const cvFor = letter => {
    const tags = new Set(letter.tags || []);
    let best = resumes[0];
    let most = 0;
    for (const r of resumes) {
      const shared = (r.tags || []).filter(t => tags.has(t)).length;
      if (shared > most) { best = r; most = shared; }
    }
    return best;
  };
  // A card: the page's top as a picture, what it is, and two main actions; the rest under "More".
  const card = d => {
    const cv = d.type !== 'cover';
    const tailorFrom = cv ? d : cvFor(d);
    return `<article class="doc-card">
    <a class="doc-thumb" href="#edit-${d.id}" aria-label="Open ${esc(d.title)}">${miniPreview(d)}</a>
    <div class="doc-meta">
      <div class="doc-head"><span class="badge ${cv ? '' : 'badge-alt'}">${cv ? 'CV' : 'Cover letter'}</span><span class="muted small">${timeAgo(d.updatedAt)}</span></div>
      <h3 title="${esc(d.title)}"><a href="#edit-${d.id}">${esc(d.title)}</a></h3>
      ${d.tags?.length ? `<div class="doc-tag-row">${d.tags.map(t => `<span class="doc-tag">${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="doc-actions">
        <a class="btn btn-sm btn-primary" href="#edit-${d.id}">Edit</a>
        ${tailorFrom ? `<a class="btn btn-sm btn-ghost" href="#tailor-${tailorFrom.id}" title="${cv
    ? 'Tailor a copy of this CV, with a cover letter, to a job ad'
    : `Tailor a CV and a new cover letter to a job ad, starting from “${esc(tailorFrom.title)}”`}">✦ Tailor</a>` : ''}
        <details class="doc-more">
          <summary class="btn btn-sm btn-ghost" aria-label="More actions for ${esc(d.title)}" title="More actions">•••</summary>
          <div class="doc-more-pop" role="menu">
            <button role="menuitem" data-act="dup" data-id="${d.id}">Duplicate</button>
            ${cv ? `<button role="menuitem" data-act="letter-from" data-id="${d.id}">New cover letter from this CV</button>` : ''}
            <button role="menuitem" class="danger" data-act="del" data-id="${d.id}">Delete…</button>
          </div>
        </details>
      </div>
    </div>
  </article>`;
  };
  return `<section class="section">
    <div class="section-head">
      <h1>My documents</h1>
      <div class="cta-row">
        <button class="btn btn-primary" data-act="new-resume">+ New CV</button>
        <button class="btn btn-ghost" data-act="new-cover">+ New cover letter</button>
        <label class="btn btn-ghost">Import CV<input type="file" accept=".pdf,.txt,.json" data-act="import" hidden></label>
      </div>
    </div>
    ${tagBar}
    ${docs.length ? `<div class="doc-grid">${docs.map(card).join('')}</div>` : `
      <div class="empty">
        <h3>No documents yet</h3>
        <p>Start from scratch, import an existing CV, or explore with sample content.</p>
        <div class="cta-row center">
          <button class="btn btn-primary" data-act="new-resume">Create a CV</button>
          <button class="btn btn-ghost" data-act="samples">Load samples</button>
        </div>
      </div>`}
    <p class="muted small">${account.user
      ? `Saved to your account (${esc(account.user.email)}), with a working copy in this browser so you can keep editing offline.`
      : 'Documents are saved automatically in this browser (localStorage). Use “Export JSON” in the editor to back them up.'}${
      account.available && !account.user ? ' <a href="#signup">Create an account</a> to keep them on any device.' : ''}</p>
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
  else if (act === 'sign-out') signOut();
  else if (act === 'doc-tag') { docTag = b.dataset.tag; route(); }
  else if (act === 'del') {
    const d = store.get(b.dataset.id);
    confirmDialog(`Delete “${d?.title || 'this document'}”? This cannot be undone.`, 'Delete', true).then(ok => { if (ok) { store.remove(b.dataset.id); route(); } });
  }
  else if (act === 'letter-from') {
    const r = store.get(b.dataset.id);
    const l = blankLetter(r.templateId, r);
    store.add(l);
    go(`#edit-${l.id}`);
  }
});

// Import a CV into a new document. From a template card (data-tpl), it opens in that template.
document.addEventListener('change', async e => {
  if (e.target.dataset.act !== 'import') return;
  const f = e.target.files[0];
  if (!f) return;
  const tpl = TEMPLATES.find(t => t.id === e.target.dataset.tpl);
  e.target.value = ''; // the same file can be chosen again
  try {
    toast(`Reading ${f.name}…`, 8000);
    const doc = await fileToDoc(f);
    if (tpl && doc.type !== 'cover') doc.templateId = tpl.id;
    store.add(doc);
    toast(tpl && doc.type !== 'cover'
      ? `Imported into the ${tpl.name} template. Check each section: reading a CV is best-effort.`
      : 'Imported. Check each section: reading a CV is best-effort.', 5000);
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
  else if (view === 'login' || view === 'signup') { html = authPage(view); mount = () => $('.auth-form input')?.focus(); }
  else if (view === 'match') { html = matchPage(arg); mount = mountMatch; }
  else if (view === 'tailor') { html = tailorPage(arg); mount = () => mountTailor(account); }
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

// Signed in already (a session cookie from an earlier visit)? Then open the account's documents.
const session = await api.session();
account.available = session.available;
renderAccount();
if (session.user) {
  // Switch to the account's working copy first (synchronous), show it at once, and merge in the
  // server's copy when it arrives.
  const ready = useAccount(session.user);
  route();
  await ready;
} else {
  route();
}
