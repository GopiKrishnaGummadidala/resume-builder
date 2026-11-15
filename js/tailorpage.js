// The Tailor page, in four steps:
//   1. The job: one box for the job ad's link or its text. A link is read by the server on its own.
//   2. CV and templates: which CV, and the templates for the tailored CV and its cover letter (previewed).
//   3. Choose an AI and Generate: Claude or ChatGPT connected through the server (one click), or the
//      ChatGPT, Claude or Gemini website (the prompt is copied and the site opened; paste its answer back).
//   4. Review each change, then download the tailored CV and its one-page cover letter.
import { store } from './store.js';
import { esc, TEMPLATES } from './templates.js';
import { $, $$, toast } from './ui.js';
import { api } from './account.js';
import { blankLetter } from './data.js';
import { miniPreview, fitPages, pageObserver } from './preview.js';
import { copyPrompt, parseReply, reviewPlan, buildTailored, buildLetter, JOB_MAX_CHARS } from './tailor.js';
import { fileToDoc } from './importer.js';
import { fitOnePage } from './fit.js';
import { downloadPdf } from './editor.js';

const PREFS_KEY = 'craftfolio.tailor';
const MIN_JOB_CHARS = 80;
const URL_ONLY = /^https?:\/\/\S+$/i;

/** The AIs to choose from. connected: runs on the server with its API key; else the AI's website. */
const AIS = [
  { id: 'claude', name: 'Claude', sub: 'Anthropic · one click, about a minute', connected: true },
  { id: 'openai', name: 'ChatGPT', sub: 'OpenAI · one click, about a minute', connected: true },
  { id: 'web-chatgpt', name: 'ChatGPT website', sub: 'chatgpt.com · free, you paste its answer back', url: 'https://chatgpt.com/', site: 'ChatGPT' },
  { id: 'web-claude', name: 'Claude website', sub: 'claude.ai · free, you paste its answer back', url: 'https://claude.ai/new', site: 'Claude' },
  { id: 'web-gemini', name: 'Gemini website', sub: 'gemini.google.com · free, you paste its answer back', url: 'https://gemini.google.com/app', site: 'Gemini' },
];

const bold = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
const options = selected => TEMPLATES.map(t => `<option value="${t.id}" ${t.id === selected ? 'selected' : ''}>${esc(t.name)}</option>`).join('');
const words = s => (String(s).match(/\S+/g) || []).length;
/** A CV in the "Start from" list: its name, then its tags, e.g. "CV – Contoso · Tailored, Contoso". */
const optionLabel = d => esc(d.title) + (d.tags?.length ? ` · ${d.tags.map(esc).join(', ')}` : '');
function prefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch { return {}; } }
function savePrefs(p) { try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs(), ...p })); } catch { /* not remembered */ } }

/** What the tailored CV will look like: the chosen CV in the chosen template. */
const cvPreview = (cv, tpl) => miniPreview({ ...cv, templateId: tpl });
/** What the cover letter will look like: the CV's details in the chosen letter template. */
function letterPreview(cv, tpl, company) {
  const l = blankLetter(tpl, cv);
  l.templateId = tpl;
  l.recipient.company = company || 'The company';
  l.body = 'Your cover letter appears here after tailoring: three or four short paragraphs on why you fit this job, written from your CV, on one page.';
  return miniPreview(l);
}

/** @param {string} pre id of the CV to start with  @param {{available: boolean, user: object|null}} account */
export function tailorPage(pre, account) {
  const resumes = store.docs.filter(d => d.type !== 'cover');
  if (!resumes.length) {
    return `<section class="section narrow tailor-empty">
      <span class="tag">TAILOR</span>
      <h1>Tailor your CV to a job</h1>
      <p class="lead">Tailoring starts from one of your CVs. Create one, or import the CV you already have.</p>
      <div class="cta-row"><button class="btn btn-primary" data-act="new-resume">Create a CV</button>
        <label class="btn btn-ghost">Import a CV<input type="file" accept=".pdf,.txt,.json" data-act="import" hidden></label></div>
    </section>`;
  }
  const cv = resumes.find(r => r.id === pre) || resumes[0];
  const p = prefs();
  const letterOn = p.letter !== false;
  const radio = ai => `<label class="t-ai" data-ai="${ai.id}">
      <input type="radio" name="t-ai" value="${ai.id}" ${ai.connected ? 'disabled' : ''}>
      <span class="t-ai-body"><strong>${esc(ai.name)}</strong><span class="t-ai-sub">${esc(ai.sub)}</span>
        ${ai.connected ? `<span class="t-ai-state" data-role="state-${ai.id}">Checking…</span>` : ''}</span>
    </label>`;
  return `<section class="section narrow tailor">
    <span class="tag">TAILOR</span>
    <h1>Tailor your CV and cover letter to a job</h1>
    <p class="lead">An AI tailors a copy of your CV to the job and writes a one-page cover letter, using only what your CV already says. You check every change, and your original CV stays as it is.</p>

    <div class="t-step">
      <h2><span class="t-num">1</span>The job</h2>
      <label class="t-label" for="t-job">Paste the job ad's link or its full text</label>
      <textarea id="t-job" data-role="t-job" rows="8" maxlength="${JOB_MAX_CHARS}" placeholder="https://… a link to the job ad&#10;or the job ad's text: the role, what you would do, what they ask for"></textarea>
      <p class="t-status" data-role="t-status" aria-live="polite"></p>
      <div class="t-row">
        <label class="field"><span>Company</span><input data-role="t-company" maxlength="120" placeholder="Filled in from the job ad"></label>
        <label class="field"><span>Role</span><input data-role="t-role" maxlength="120" placeholder="Filled in from the job ad"></label>
      </div>
    </div>

    <div class="t-step">
      <h2><span class="t-num">2</span>Your CV and templates</h2>
      <div class="field"><label for="t-doc">Start from</label>
        <div class="t-start">
          <select id="t-doc" data-role="t-doc">${resumes.map(r => `<option value="${r.id}" ${r.id === cv.id ? 'selected' : ''}>${optionLabel(r)}</option>`).join('')}</select>
          <label class="btn btn-ghost" title="Import an existing CV (PDF, text or Craftfolio JSON) and tailor that one">Import a CV<input type="file" accept=".pdf,.txt,.json" data-act="t-import" hidden></label>
        </div></div>
      <div class="t-tpls">
        <div class="t-tpl">
          <label class="field"><span>CV template</span><select data-role="t-cv-tpl">${options(cv.templateId)}</select></label>
          <div class="t-thumb" data-role="t-cv-thumb">${cvPreview(cv, cv.templateId)}</div>
        </div>
        <div class="t-tpl" data-role="t-letter-box">
          <label class="field"><span class="t-letter-opt"><input type="checkbox" data-role="t-letter" ${letterOn ? 'checked' : ''}> Cover letter template</span>
            <select data-role="t-letter-tpl" ${letterOn ? '' : 'disabled'}>${options(p.letterTpl && TEMPLATES.some(t => t.id === p.letterTpl) ? p.letterTpl : cv.templateId)}</select></label>
          <div class="t-thumb" data-role="t-letter-thumb">${letterPreview(cv, p.letterTpl || cv.templateId, '')}</div>
          <label class="field t-lang"><span>Letter language</span><select data-role="t-lang" ${letterOn ? '' : 'disabled'}>
            <option value="cv" ${p.lang !== 'job' ? 'selected' : ''}>Same as my CV</option><option value="job" ${p.lang === 'job' ? 'selected' : ''}>Same as the job ad</option></select></label>
        </div>
      </div>
      <p class="muted small">The cover letter always fits on one page. Your CV stays in its own language.</p>
    </div>

    <div class="t-step">
      <h2><span class="t-num">3</span>Choose your AI and generate</h2>
      <div class="t-ais" role="radiogroup" aria-label="AI to use">
        <p class="t-ais-h">Connected: one click, runs on this server</p>
        ${AIS.filter(a => a.connected).map(radio).join('')}
        <p class="t-ais-h">On the AI's website: free, no key needed</p>
        ${AIS.filter(a => !a.connected).map(radio).join('')}
      </div>
      <div class="t-go">
        <button class="btn btn-primary btn-lg" data-act="t-generate" disabled>✦ Generate tailored CV${letterOn ? ' &amp; cover letter' : ''}</button>
        <span class="muted small" data-role="t-wait">Add the job ad in step 1 first.</span>
      </div>
      <div class="t-paste" data-role="t-paste" hidden>
        <ol class="t-steps">
          <li>The prompt is copied and <strong data-role="t-site">the website</strong> opened in a new tab.
            <span class="small"><a data-role="t-site-link" href="#" target="_blank" rel="noopener noreferrer">Open it again</a> · <button type="button" class="link-btn" data-act="t-copy-prompt">Copy the prompt again</button></span></li>
          <li>There, paste it (<kbd>Ctrl</kbd>+<kbd>V</kbd>) and send.</li>
          <li><label for="t-reply">Copy its whole answer and paste it here:</label>
            <textarea id="t-reply" data-role="t-reply" rows="5" placeholder="Paste the AI's answer here. It is checked as soon as you paste it."></textarea>
            <span class="t-reply-error small" data-role="t-reply-error" role="alert" hidden></span></li>
        </ol>
      </div>
      <p class="muted small">Only your CV's content and the job ad go to the AI, not your name, contact details or photo.</p>
    </div>

    <div id="t-result" aria-live="polite"></div>
  </section>`;
}

export function mountTailor(account) {
  const root = $('.tailor');
  if (!root) return;
  const field = role => $(`[data-role="${role}"]`, root);
  const result = $('#t-result');
  const generateBtn = $('[data-act="t-generate"]', root);
  const canFetch = account.available && !!account.user;
  let source = ''; // the job ad's site, when read from a link
  let fetchedFrom = ''; // the link last read
  let review = null; // { doc, job, changes, rejected, found, matched, missing, notes }

  // ---- step 1: the job ----
  const status = (html, kind = '') => { const s = field('t-status'); s.className = `t-status ${kind}`; s.innerHTML = html; };
  function jobState() {
    const text = field('t-job').value.trim();
    if (!text) { status(''); return; }
    if (URL_ONLY.test(text)) return; // a link: fetchLink() reports
    if (text.length < MIN_JOB_CHARS) status('Add a bit more of the job ad: at least a few sentences.', 'warn');
    else status(`✓ ${words(text)} words${source ? ` · read from ${esc(source)}` : ''}`, 'good');
  }
  async function fetchLink(url) {
    if (url === fetchedFrom) return;
    if (!canFetch) {
      status(account.available
        ? 'Links can be read when you are signed in. <a href="#login">Sign in</a>, or open the link and paste the job ad\'s text here instead.'
        : 'Links can be read only with the Craftfolio server. Open the link and paste the job ad\'s text here instead.', 'warn');
      return;
    }
    fetchedFrom = url;
    let host = '';
    try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { /* checked by the server */ }
    status(`<span class="spinner" aria-hidden="true"></span> Reading the job ad from ${esc(host || 'the link')}…`);
    field('t-job').readOnly = true;
    try {
      const found = await api.fetchJob(url);
      if (field('t-job').value.trim() !== url) return; // the box changed meanwhile
      field('t-job').value = found.description;
      if (found.company) field('t-company').value = found.company;
      if (found.role) field('t-role').value = found.role;
      source = found.source || host;
      refresh();
      updateLetterThumb();
      status(`✓ Read from ${esc(source)} · ${words(found.description)} words. Check the text, then go on. <button type="button" class="link-btn" data-act="t-clear">Use another link or text</button>`, 'good');
    } catch (err) {
      fetchedFrom = '';
      status(`${esc(err.message)} <button type="button" class="link-btn" data-act="t-retry">Try again</button>`, 'bad');
    } finally {
      field('t-job').readOnly = false;
    }
  }
  let jobTimer = null;
  field('t-job').addEventListener('input', () => {
    clearTimeout(jobTimer);
    const text = field('t-job').value.trim();
    if (!text) { source = ''; fetchedFrom = ''; }
    jobTimer = setTimeout(() => (URL_ONLY.test(text) ? fetchLink(text) : (jobState(), refresh())), URL_ONLY.test(text) ? 250 : 150);
  });
  field('t-company').addEventListener('input', () => updateLetterThumb());

  // ---- step 2: CV and templates ----
  const cv = () => store.get(field('t-doc').value);
  function setThumb(role, html) {
    const box = field(role);
    box.innerHTML = html;
    box.querySelectorAll('.page-fit').forEach(el => pageObserver.observe(el));
    requestAnimationFrame(() => fitPages());
  }
  const updateCvThumb = () => setThumb('t-cv-thumb', cvPreview(cv(), field('t-cv-tpl').value));
  const updateLetterThumb = () => setThumb('t-letter-thumb', letterPreview(cv(), field('t-letter-tpl').value, field('t-company').value.trim()));
  field('t-doc').addEventListener('change', () => {
    field('t-cv-tpl').value = cv().templateId;
    if (!prefs().letterTpl) field('t-letter-tpl').value = cv().templateId;
    updateCvThumb();
    updateLetterThumb();
  });
  field('t-cv-tpl').addEventListener('change', updateCvThumb);
  // Import a CV right here: it is saved to My documents and becomes the CV to tailor.
  $('[data-act="t-import"]', root).addEventListener('change', async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    try {
      toast(`Reading ${f.name}…`, 8000);
      const doc = await fileToDoc(f);
      if (doc.type === 'cover') throw new Error('that is a cover letter; choose a CV');
      store.add(doc);
      field('t-doc').insertAdjacentHTML('afterbegin', `<option value="${doc.id}">${optionLabel(doc)}</option>`);
      field('t-doc').value = doc.id;
      field('t-doc').dispatchEvent(new Event('change'));
      toast(`Imported “${doc.title}” and selected it. It is also saved in My documents.`, 5000);
    } catch (err) {
      toast(`Import failed: ${err.message}`, 6000);
    }
  });
  field('t-letter-tpl').addEventListener('change', () => { savePrefs({ letterTpl: field('t-letter-tpl').value }); updateLetterThumb(); });
  field('t-lang').addEventListener('change', () => savePrefs({ lang: field('t-lang').value }));
  field('t-letter').addEventListener('change', e => {
    const on = e.target.checked;
    field('t-letter-tpl').disabled = !on;
    field('t-lang').disabled = !on;
    field('t-letter-box').classList.toggle('off', !on);
    savePrefs({ letter: on });
    refresh();
  });
  if (!field('t-letter').checked) field('t-letter-box').classList.add('off');

  // ---- step 3: choose an AI and generate ----
  const job = () => ({
    description: URL_ONLY.test(field('t-job').value.trim()) ? '' : field('t-job').value.trim(),
    company: field('t-company').value.trim(),
    role: field('t-role').value.trim(),
    letterLanguage: field('t-lang').value,
    source,
  });
  const ready = () => job().description.length >= MIN_JOB_CHARS;
  const chosen = () => AIS.find(a => a.id === $('input[name="t-ai"]:checked', root)?.value);
  function choose(id) {
    const input = $(`input[name="t-ai"][value="${id}"]`, root);
    if (input && !input.disabled) input.checked = true;
    $$('.t-ai', root).forEach(l => l.classList.toggle('on', !!$('input', l).checked));
  }
  function refresh() {
    const ai = chosen();
    const ok = ready();
    generateBtn.disabled = !ok || !ai;
    generateBtn.innerHTML = `✦ Generate tailored CV${field('t-letter').checked ? ' &amp; cover letter' : ''}${ai ? ` with ${esc(ai.name)}` : ''}`;
    field('t-wait').textContent = !ok ? 'Add the job ad in step 1 first.' : !ai ? 'Choose an AI above.' : '';
  }
  $$('input[name="t-ai"]', root).forEach(input => input.addEventListener('change', () => {
    choose(input.value);
    savePrefs({ ai: input.value });
    field('t-paste').hidden = true;
    refresh();
  }));

  // Which connected AIs this server has, and whether this person may use them.
  const setState = (id, text, usable) => {
    const el = field(`state-${id}`);
    if (el) { el.innerHTML = text; el.classList.toggle('ready', usable); }
    const input = $(`input[name="t-ai"][value="${id}"]`, root);
    if (input) input.disabled = !usable;
    $(`.t-ai[data-ai="${id}"]`, root)?.classList.toggle('disabled', !usable);
  };
  const pickDefault = () => {
    const want = prefs().ai;
    const usable = AIS.filter(a => !$(`input[name="t-ai"][value="${a.id}"]`, root).disabled).map(a => a.id);
    choose(usable.includes(want) ? want : usable[0]);
    refresh();
  };
  const noKey = 'Needs an API key in the server\'s .env file';
  if (!account.available) {
    for (const id of ['claude', 'openai']) setState(id, 'Needs the Craftfolio server', false);
    pickDefault();
  } else {
    api.tailorStatus().then(providers => {
      for (const id of ['claude', 'openai']) {
        if (!providers[id]) setState(id, noKey, false);
        else if (!account.user) setState(id, '<a href="#login">Sign in</a> to use it', false);
        else setState(id, '✓ Ready', true);
      }
      pickDefault();
    }).catch(() => {
      for (const id of ['claude', 'openai']) setState(id, 'Could not reach the server', false);
      pickDefault();
    });
  }

  function show(base, j, plan) {
    const checked = reviewPlan(base, plan);
    // Company and role left empty: take them from the job ad, as the AI read them.
    for (const key of ['company', 'role']) {
      if (!j[key] && checked.found[key]) { j[key] = checked.found[key]; field(`t-${key}`).value = checked.found[key]; }
    }
    review = { doc: base, job: j, ...checked };
    if (!field('t-letter').checked) review.changes = review.changes.filter(c => c.key !== 'letter');
    renderReview();
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  async function copyThePrompt() {
    try {
      await navigator.clipboard.writeText(copyPrompt(cv(), job()));
      return true;
    } catch {
      return false;
    }
  }

  async function generate() {
    const ai = chosen();
    if (!ai || !ready()) return;
    if (ai.connected) {
      const base = cv();
      const j = job();
      generateBtn.disabled = true;
      generateBtn.innerHTML = `<span class="spinner" aria-hidden="true"></span> ${esc(ai.name)} is tailoring… about a minute`;
      try {
        // The photo is not needed for tailoring; leave it out of the request.
        const plan = await api.tailor({ ...base, personal: { ...base.personal, photo: '' } }, j, ai.id);
        show(base, j, plan);
      } catch (err) {
        toast(err.message, 6000);
      } finally {
        refresh();
      }
      return;
    }
    // A website: copy the prompt, open the site, and wait for the answer to be pasted back.
    const copied = copyThePrompt(); // started while this page still has focus
    window.open(ai.url, '_blank', 'noopener,noreferrer');
    field('t-site').textContent = ai.site;
    field('t-site-link').href = ai.url;
    field('t-paste').hidden = false;
    if (!(await copied)) toast('The prompt could not be copied automatically: use “Copy the prompt again”.', 6000);
    else toast(`Prompt copied. Paste it into ${ai.site}, then paste its answer back here.`, 5000);
    field('t-paste').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // The AI's answer is checked as soon as it is pasted.
  let replyTimer = null;
  field('t-reply').addEventListener('input', () => {
    clearTimeout(replyTimer);
    const err = field('t-reply-error');
    err.hidden = true;
    const text = field('t-reply').value.trim();
    if (!text) return;
    replyTimer = setTimeout(() => {
      if (!ready()) { err.textContent = 'Add the job ad in step 1 first, so the answer can be matched to it.'; err.hidden = false; return; }
      try {
        show(cv(), job(), parseReply(text));
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
      }
    }, 300);
  });

  // ---- step 4: review, then the documents ----
  function renderReview() {
    const r = review;
    const chips = (list, cls) => list.map(k => `<span class="t-chip ${cls}">${esc(k)}</span>`).join('');
    const side = (v, cls) => (Array.isArray(v)
      ? `<ul class="${cls}">${v.map(b => `<li>${bold(b)}</li>`).join('')}</ul>`
      : `<p class="${cls}">${bold(v) || '<em class="muted">(empty)</em>'}</p>`);
    const body = c => (c.key === 'letter'
      ? `<div class="t-letter"><p>${esc(c.greeting)}</p>${c.after.map(p => `<p>${bold(p)}</p>`).join('')}<p>${esc(c.closing)}</p></div>`
      : `<div class="t-diff"><div><span class="t-side muted small">Now</span>${side(c.before, 't-before')}</div><div><span class="t-side small">Tailored</span>${side(c.after, 't-after')}</div></div>`);
    result.innerHTML = `<div class="t-step t-review">
      <h2><span class="t-num">4</span>Check the changes</h2>
      <p class="muted">${r.changes.length} change${r.changes.length === 1 ? '' : 's'} proposed${r.rejected.length ? `, ${r.rejected.length} left out to keep your CV accurate` : ''}. Untick any you do not want.</p>
      ${r.matched.length ? `<p class="t-kw"><strong>Covered from the job:</strong> ${chips(r.matched, 'good')}</p>` : ''}
      ${r.missing.length ? `<p class="t-kw"><strong>Asked for, not in your CV:</strong> ${chips(r.missing, 'warn')}<br><span class="muted small">Not added. Add any of these yourself only if they are true for you.</span></p>` : ''}
      ${r.notes.length ? `<ul class="t-notes">${r.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      ${r.changes.length ? r.changes.map((c, i) => `<article class="t-change">
          <label class="t-pick"><input type="checkbox" data-change="${i}" checked> <strong>${esc(c.label)}</strong>${c.key === 'letter' ? ' <span class="muted small">(its own document, on one page)</span>' : ''}</label>
          ${body(c)}
        </article>`).join('') : '<p class="muted">No changes were proposed that passed the checks.</p>'}
      ${r.rejected.length ? `<details class="t-rejected"><summary>Why ${r.rejected.length} proposal${r.rejected.length === 1 ? ' was' : 's were'} left out</summary><ul>${r.rejected.map(x => `<li><strong>${esc(x.label)}:</strong> ${esc(x.reason)}</li>`).join('')}</ul></details>` : ''}
      <div class="cta-row t-save-row"><button class="btn btn-primary btn-lg" data-act="t-save" ${r.changes.length ? '' : 'disabled'}>Create my tailored documents</button>
        <span class="muted small">Saved next to the original, tagged “Tailored”${r.job.company ? ` and “${esc(r.job.company.slice(0, 24))}”` : ''}.</span></div>
    </div>`;
  }

  function renderDone(made) {
    const card = (d, what, extra = '') => `<article class="t-made">
        <div class="t-thumb small">${miniPreview(d)}</div>
        <div class="t-made-info"><span class="badge ${d.type === 'cover' ? 'badge-alt' : ''}">${what}</span><h3>${esc(d.title)}</h3><p class="muted small">${esc(TEMPLATES.find(t => t.id === d.templateId)?.name || '')} template${extra}</p>
          <div class="cta-row"><button class="btn btn-primary" data-download="${d.id}">Download PDF</button><a class="btn btn-ghost" href="#edit-${d.id}">Open to edit</a></div></div>
      </article>`;
    result.innerHTML = `<div class="t-step t-done">
      <h2><span class="t-num">✓</span>Your tailored documents are ready</h2>
      ${made.map(m => card(m.doc, m.doc.type === 'cover' ? 'Cover letter' : 'CV', m.extra)).join('')}
      <p class="muted small">Both are saved in My documents. Read them once before you send them; you can still change anything.</p>
      <div class="cta-row"><button class="btn btn-ghost" data-act="t-again">Tailor for another job</button><a class="btn btn-ghost" href="#documents">Go to my documents</a></div>
    </div>`;
    result.querySelectorAll('.page-fit').forEach(el => pageObserver.observe(el));
    requestAnimationFrame(() => fitPages());
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function startOver() {
    field('t-job').value = '';
    field('t-company').value = '';
    field('t-role').value = '';
    field('t-reply').value = '';
    field('t-paste').hidden = true;
    source = '';
    fetchedFrom = '';
    review = null;
    result.innerHTML = '';
    status('');
    refresh();
    updateLetterThumb();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    field('t-job').focus({ preventScroll: true });
  }

  root.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    if (act === 't-generate') generate();
    else if (act === 't-copy-prompt') {
      if (await copyThePrompt()) toast('Prompt copied again.');
      else toast('Could not copy automatically. Allow clipboard access, or try again.');
    } else if (act === 't-clear') {
      field('t-job').value = '';
      source = '';
      fetchedFrom = '';
      status('');
      refresh();
      field('t-job').focus();
    } else if (act === 't-retry') {
      fetchLink(field('t-job').value.trim());
    } else if (act === 't-again') {
      startOver();
    }
  });

  result.addEventListener('click', async e => {
    const dl = e.target.closest('[data-download]');
    if (dl) { const d = store.get(dl.dataset.download); if (d) downloadPdf(d, dl); return; }
    if (e.target.closest('[data-act="t-again"]')) { startOver(); return; }
    if (!e.target.closest('[data-act="t-save"]') || !review) return;
    const accepted = review.changes.filter((_, i) => $(`[data-change="${i}"]`, result)?.checked);
    if (!accepted.length) { toast('Tick at least one change to keep.'); return; }
    const settings = { ...review.job, templateId: field('t-cv-tpl').value, letterTemplateId: field('t-letter-tpl').value };
    const tailored = buildTailored(review.doc, accepted, settings);
    store.add(tailored);
    const made = [{ doc: tailored }];
    const letterChange = field('t-letter').checked && accepted.find(c => c.key === 'letter');
    if (letterChange) {
      await document.fonts?.ready;
      // One page, always: when the template's spacing makes it spill over, tighten it now.
      const fit = fitOnePage(buildLetter(tailored, letterChange, settings));
      store.add(fit.doc);
      made.push({ doc: fit.doc, extra: fit.pages > 1 ? ` · runs to ${fit.pages} pages: shorten it` : fit.changed ? ' · spacing tightened to fit one page' : ' · one page' });
    }
    toast(made.length > 1 ? 'Created your tailored CV and cover letter.' : 'Created your tailored CV.');
    renderDone(made);
  });

  refresh();
}
