// The document editor: form on the left, live A4 preview in the middle, coach on the right.
// The form and the preview both edit the same in-memory document; every change is saved through the store.
import { draftLetterBody, THEME_COLORS, FONTS, uid, splitLines, DEFAULT_PERSONAL } from './data.js';
import { store } from './store.js';
import { TEMPLATES, renderDoc, esc, letterBlocks, PAGE } from './templates.js';
import { coachResume, coachLetter, strengthenBullet } from './analysis.js';
import { htmlToLetterText, editableToLetterText, toggleBold, toggleHeading, editableBold, editableHeading } from './richtext.js';
import { $, $$, toast, confirmDialog, fileNameDialog, setPath, getPath } from './ui.js';
import { saveFile } from './platform.js';
import { buildPdf, pdfName } from './pdf-export.js';
import { fitPages, pageObserver } from './preview.js';

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

export function editorPage(id) {
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
        ${doc.type === 'cover' ? '<p class="edit-tip no-print">Click the letter to edit it directly: recipient, date, greeting, body and closing. Ctrl+B for bold.</p>' : ''}
        <div class="page-fit" id="live">${renderDoc(doc, { editable: true })}</div>
        <p class="overflow-warn" hidden>Content runs past one page — it will continue on page 2 in the PDF.</p>
      </div>
      <aside class="ed-coach no-print" id="coach">${coachPanel(doc)}</aside>
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
    const page = $('.page', live);
    $('.overflow-warn', root).hidden = page.scrollHeight <= PAGE.H + 2;
    $('#coach').innerHTML = coachPanel(doc);
  };
  const refresh = () => {
    live.innerHTML = renderDoc(doc, { editable: true });
    updateAround();
  };
  const save = () => store.touch(doc); // debounced write; flushed when the page is hidden
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
    if (path === 'recipient.name' && doc.type === 'cover') syncGreeting(e.target.value);
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
  // Single-line fields on the page (recipient, date, greeting, closing).
  const greetingFor = name => `Dear ${name || 'Hiring Manager'},`;
  live.addEventListener('input', e => {
    const fieldEl = e.target.closest?.('[data-edit-field]');
    if (!fieldEl) return;
    const path = fieldEl.dataset.editField;
    const value = fieldEl.textContent.replace(/\s+/g, ' ').trim();
    if (path === 'recipient.name') syncGreeting(value);
    setPath(doc, path, value);
    const input = $(`.ed-form [data-path="${path}"]`, root);
    if (input) input.value = value;
    updateAround();
    save();
  });
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
    if ((e.target.classList?.contains('l-edit') || e.target.dataset?.editField) && !live.contains(e.relatedTarget)) refresh();
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
      const src = store.docs.find(d => d.type !== 'cover');
      if (src) { doc.personal = { ...src.personal }; rerenderForm(); toast(`Copied details from “${src.title}”`); }
    } else if (act === 'download') {
      downloadPdf(doc, b);
    } else if (act === 'export-json') {
      saveFile(`${(doc.title || 'document').replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(doc, null, 2));
    }
  });
  refresh();
}

async function downloadPdf(doc, btn) {
  const filename = await fileNameDialog(pdfName(doc), 'pdf');
  if (!filename) return;
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Building PDF…'; }
  try {
    const { blob } = await buildPdf(doc, $('#print-area'), { title: filename.replace(/\.pdf$/, '') });
    if (await saveFile(filename, blob)) toast(`Downloaded ${filename} (${Math.max(1, Math.round(blob.size / 1024))} KB)`);
  } catch (err) {
    toast(`PDF failed: ${err.message}`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}
