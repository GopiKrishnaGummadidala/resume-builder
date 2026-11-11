// Standalone tools: ATS checker and job matcher. Both work on plain text, so they accept a saved CV,
// pasted text or an uploaded file.
import { resumeToText } from './data.js';
import { store } from './store.js';
import { esc } from './templates.js';
import { atsCheck, matchJob } from './analysis.js';
import { fileToText, parseResumeText } from './importer.js';
import { $, toast, go } from './ui.js';

export function atsPage() {
  const resumes = store.docs.filter(d => d.type !== 'cover');
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

export function mountAts() {
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

export function matchPage(pre) {
  const resumes = store.docs.filter(d => d.type !== 'cover');
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

export function mountMatch() {
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
