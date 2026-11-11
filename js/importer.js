// Import an existing resume: PDF (via pdf.js, loaded on demand), plain text, or a Craftfolio JSON export.
import { blankResume, uid } from './data.js';
import { loadLib, libUrl } from './platform.js';

// The worker script is loaded in-page (it defines window.pdfjsWorker) so pdf.js runs on the main
// thread; cross-origin Web Workers are blocked in sandboxed hosts.
async function loadPdfJs() {
  await loadLib('pdfjsWorker');
  const pdfjs = await loadLib('pdfjs');
  pdfjs.GlobalWorkerOptions.workerSrc = libUrl('pdfjsWorker');
  return pdfjs;
}

export async function fileToText(file) {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
    let out = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let lastY = null;
      for (const item of content.items) {
        const y = item.transform?.[5];
        if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
        out += item.str;
        if (item.hasEOL) out += '\n';
        else if (item.str && !item.str.endsWith(' ')) out += ' ';
        lastY = y ?? lastY;
      }
      out += '\n';
    }
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  }
  return file.text();
}

const HEADINGS = [
  ['summary', /^(professional\s+)?(summary|profile|about( me)?|objective|career objective)$/i],
  ['experience', /^(work\s+|professional\s+)?(experience|employment( history)?|work history|career history)$/i],
  ['education', /^(education|academic background|qualifications)$/i],
  ['skills', /^((technical|core|key)\s+)?(skills|competencies|expertise|areas of expertise)$/i],
  ['projects', /^(projects|selected projects|personal projects)$/i],
  ['certifications', /^(certifications?|licenses?( & certifications)?|courses)$/i],
  ['languages', /^languages?$/i],
];

const BULLET = /^[•\-*▪◦●]\s*/;
const DATE_RANGE = /((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2})\s*[-–—to]+\s*((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+)?((?:19|20)\d{2}|present|current|now)/i;

/** Best-effort conversion of resume text into structured CV fields. */
export function parseResumeText(text) {
  const r = blankResume();
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const phone = text.match(/\+?\d[\d\s().-]{7,}\d/);
  const linkedin = text.match(/linkedin\.com\/[^\s|,]+/i);
  if (email) r.personal.email = email[0];
  if (phone) r.personal.phone = phone[0].trim();
  if (linkedin) r.personal.linkedin = linkedin[0];

  const buckets = { header: [] };
  let current = 'header';
  for (const line of lines) {
    const clean = line.replace(/[:|]+$/, '').trim();
    const h = clean.length < 40 && HEADINGS.find(([, re]) => re.test(clean));
    if (h) { current = h[0]; buckets[current] = buckets[current] || []; continue; }
    buckets[current] = buckets[current] || [];
    buckets[current].push(line);
  }

  const head = buckets.header.filter(l => !l.includes('@') && !/\d{3}/.test(l));
  r.personal.name = head[0] || '';
  if (head[1] && head[1].length < 60) r.personal.title = head[1];

  if (buckets.summary) r.summary = buckets.summary.join(' ');

  if (buckets.experience) {
    let item = null;
    for (const line of buckets.experience) {
      if (BULLET.test(line)) {
        if (!item) item = newExp(r);
        item.bullets += (item.bullets ? '\n' : '') + line.replace(BULLET, '');
      } else if (item && item.bullets && /^[a-z]/.test(line)) {
        item.bullets += ' ' + line; // wrapped bullet continuation
      } else {
        const d = line.match(DATE_RANGE);
        if (!item || item.bullets) item = newExp(r);
        const rest = line.replace(DATE_RANGE, '').replace(/[|,–—-]\s*$/, '').trim();
        if (d) { item.start = d[0].split(/[-–—]|to/)[0].trim(); item.end = (d[4] || '').replace(/^\w/, c => c.toUpperCase()); }
        if (rest) {
          if (!item.role) item.role = rest;
          else if (!item.company) item.company = rest;
        }
      }
    }
  }

  if (buckets.education) {
    let ed = null;
    for (const line of buckets.education) {
      const d = line.match(DATE_RANGE) || line.match(/(19|20)\d{2}/);
      if (!ed || (ed.degree && ed.school)) { ed = { id: uid(), degree: '', school: '', location: '', start: '', end: '', details: '' }; r.education.push(ed); }
      const rest = line.replace(DATE_RANGE, '').trim();
      if (d) ed.end = d[4] || d[0];
      if (!ed.degree) ed.degree = rest; else if (!ed.school) ed.school = rest; else ed.details += rest + ' ';
    }
  }

  if (buckets.skills) r.skills = buckets.skills.map(l => l.replace(BULLET, '')).join(', ').replace(/\s*[|•·]\s*/g, ', ');
  if (buckets.projects) r.projects = buckets.projects.filter(l => !BULLET.test(l)).slice(0, 5).map(l => ({ id: uid(), name: l, link: '', description: '' }));
  if (buckets.certifications) r.certifications = buckets.certifications.map(l => l.replace(BULLET, '')).join(', ');
  if (buckets.languages) r.languages = buckets.languages.map(l => l.replace(BULLET, '')).join(', ');

  r.title = r.personal.name ? `${r.personal.name} — imported` : 'Imported CV';
  return r;
}

function newExp(r) {
  const e = { id: uid(), role: '', company: '', location: '', start: '', end: '', bullets: '' };
  r.experience.push(e);
  return e;
}
