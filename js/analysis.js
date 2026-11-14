// Rule-based resume coach, ATS checker and job matcher. Runs fully in the browser.
import { splitLines, splitList } from './data.js';
import { TEMPLATES } from './templates.js';

const ACTION_VERBS = new Set(`accelerated achieved acquired adapted administered advised analyzed architected assessed automated balanced boosted built captured championed coached collaborated completed conceived conducted consolidated coordinated created cultivated cut decreased defined delivered deployed designed developed devised directed doubled drove eliminated enabled engineered enhanced established evaluated exceeded executed expanded facilitated forecasted founded generated grew guided headed identified implemented improved increased influenced initiated innovated launched led leveraged maintained managed maximized mentored migrated modernized negotiated optimized orchestrated organized overhauled oversaw partnered performed pioneered planned prioritized produced programmed promoted proposed published ran rebuilt redesigned reduced refactored resolved restructured revamped saved scaled secured shipped simplified spearheaded standardized streamlined strengthened supervised supported surpassed taught tested trained transformed tripled unified upgraded won wrote`.split(/\s+/));

const WEAK_OPENERS = [
  [/^responsible for\s+/i, 'Managed '],
  [/^in charge of\s+/i, 'Led '],
  [/^worked on\s+/i, 'Developed '],
  [/^helped (to )?/i, 'Contributed to '],
  [/^assisted (with|in)\s+/i, 'Supported '],
  [/^was involved in\s+/i, 'Contributed to '],
  [/^tasked with\s+/i, 'Delivered '],
  [/^duties included\s+/i, 'Handled '],
  [/^did\s+/i, 'Completed '],
  [/^made\s+/i, 'Created '],
];

const PRONOUNS = /\b(I|me|my|mine|myself)\b/;
const NUMBER = /\d|%|\$|€|£/;

const firstWord = s => (s.match(/^[A-Za-z-]+/)?.[0] || '').toLowerCase();
export const isActionVerb = b => ACTION_VERBS.has(firstWord(b)) || /ed$/.test(firstWord(b));

/** Suggest a stronger rewrite of a bullet (local heuristic, no network). */
export function strengthenBullet(b) {
  let out = b.trim();
  for (const [re, rep] of WEAK_OPENERS) if (re.test(out)) { out = out.replace(re, rep); break; }
  out = out.replace(/\.$/, '');
  if (out) out = out[0].toUpperCase() + out.slice(1);
  return out;
}

/** Coach a CV: returns { score, checks: [{ok, level, text, section}] } */
export function coachResume(r) {
  const checks = [];
  const add = (ok, text, section, weight = 1) => checks.push({ ok, text, section, weight });
  const p = r.personal;
  add(!!p.name, 'Add your full name', 'personal', 2);
  add(/\S+@\S+\.\S+/.test(p.email), 'Add a valid email address', 'personal', 2);
  add(!!p.phone, 'Add a phone number', 'personal');
  add(!!p.location, 'Add your city / location', 'personal');
  add(!!p.title, 'Add a headline / job title under your name', 'personal');

  const sw = (r.summary || '').split(/\s+/).filter(Boolean).length;
  add(sw >= 25 && sw <= 90, sw ? `Summary is ${sw} words — aim for 25–90` : 'Write a short professional summary (2–4 sentences)', 'summary', 2);
  add(!PRONOUNS.test(r.summary || ''), 'Avoid first-person pronouns (I, my) in your summary', 'summary');

  add(r.experience.length > 0, 'Add at least one work experience (internships and volunteering count)', 'experience', 3);
  let allBullets = [];
  r.experience.forEach(e => {
    const bs = splitLines(e.bullets);
    allBullets = allBullets.concat(bs);
    const label = e.role || e.company || 'a role';
    add(!!(e.role && e.company), `Fill in role and company for ${label}`, 'experience');
    add(!!(e.start && e.end), `Add start and end dates for ${label}`, 'experience');
    add(bs.length >= 3 && bs.length <= 6, `${label}: use 3–6 bullet points (currently ${bs.length})`, 'experience');
  });
  if (allBullets.length) {
    const verbs = allBullets.filter(isActionVerb).length;
    const nums = allBullets.filter(b => NUMBER.test(b)).length;
    const long = allBullets.filter(b => b.split(/\s+/).length > 30).length;
    const weak = allBullets.filter(b => WEAK_OPENERS.some(([re]) => re.test(b))).length;
    add(verbs / allBullets.length >= 0.7, `Start bullets with action verbs (${verbs}/${allBullets.length} do)`, 'experience', 2);
    add(nums / allBullets.length >= 0.4, `Quantify achievements with numbers (${nums}/${allBullets.length} bullets have metrics)`, 'experience', 2);
    add(long === 0, `${long} bullet(s) are over 30 words — tighten them`, 'experience');
    add(weak === 0, `${weak} bullet(s) start with weak phrases like "Responsible for" — use “Strengthen”`, 'experience');
    add(!allBullets.some(b => PRONOUNS.test(b)), 'Remove first-person pronouns from bullet points', 'experience');
    const endings = allBullets.map(b => /\.$/.test(b));
    add(endings.every(Boolean) || endings.every(x => !x), 'Be consistent: end all bullets with a period, or none', 'experience');
  }

  add(r.education.length > 0, 'Add your education', 'education', 2);
  const skills = splitList(r.skills);
  add(skills.length >= 5, `List at least 5 relevant skills (currently ${skills.length})`, 'skills', 2);
  add(skills.length <= 20, 'Too many skills dilutes focus — keep it under 20', 'skills');

  const tpl = TEMPLATES.find(t => t.id === r.templateId);
  add(tpl?.tags.includes('ats'), 'Two-column templates can parse out of order in some ATS — consider a single-column template for online applications', 'design');

  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter(c => c.ok).reduce((s, c) => s + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks };
}

export function coachLetter(l) {
  const checks = [];
  const add = (ok, text, weight = 1) => checks.push({ ok, text, weight });
  const words = (l.body || '').split(/\s+/).filter(Boolean).length;
  const paras = (l.body || '').split(/\n\s*\n/).filter(s => s.trim() && !/^#{1,3}\s/.test(s.trim())).length;
  const hasHeadings = /^#{1,3}\s/m.test(l.body || '');
  add(!!l.personal.name && /\S+@\S+/.test(l.personal.email), 'Include your name and email', 2);
  add(!!l.recipient.company, 'Name the company you are applying to', 2);
  add(!!l.job.role, 'Mention the exact job title', 2);
  add(!/to whom it may concern/i.test(l.greeting), 'Avoid “To whom it may concern” — address a person or the hiring team');
  add(!!l.recipient.name, 'Address the hiring manager by name if you can find it');
  add(words >= 200 && words <= (hasHeadings ? 550 : 400), `Length is ${words} words — aim for 200–${hasHeadings ? 550 : 400}`, 2);
  add(paras >= 3 && paras <= (hasHeadings ? 8 : 5), `Use 3–${hasHeadings ? 8 : 5} short paragraphs (currently ${paras})`);
  add(!l.recipient.company || (l.body || '').includes(l.recipient.company), 'Mention the company name in the letter body');
  add(NUMBER.test(l.body || ''), 'Include at least one quantified achievement');
  add(!/\[(job title|company)\]/i.test(l.body || ''), 'Replace the [placeholders] in the draft', 2);
  const total = checks.reduce((s, c) => s + c.weight, 0);
  const got = checks.filter(c => c.ok).reduce((s, c) => s + c.weight, 0);
  return { score: Math.round((got / total) * 100), checks };
}

/** ATS check on raw resume text (pasted, uploaded PDF, or a saved CV). */
export function atsCheck(text) {
  const t = (text || '').replace(/\*\*/g, ''); // bold markers from an imported PDF are not words
  const lower = t.toLowerCase();
  const words = t.split(/\s+/).filter(Boolean);
  const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
  const bullets = lines.filter(l => /^[•\-*▪◦●]/.test(l)).map(l => l.replace(/^[•\-*▪◦●]\s*/, ''));
  const has = re => re.test(lower);
  const groups = [
    {
      name: 'Contact information',
      items: [
        [/\S+@\S+\.\S+/.test(t), 'Email address found'],
        [/(\+?\d[\d\s().-]{7,}\d)/.test(t), 'Phone number found'],
        [has(/linkedin\.com|github\.com|portfolio|https?:\/\//), 'Profile link (LinkedIn / portfolio)'],
      ],
    },
    {
      name: 'Standard sections',
      items: [
        [has(/\b(experience|employment|work history)\b/), 'Experience section heading'],
        [has(/\b(education|academic)\b/), 'Education section heading'],
        [has(/\bskills?\b/), 'Skills section heading'],
        [has(/\b(summary|profile|objective|about)\b/), 'Summary / profile heading'],
      ],
    },
    {
      name: 'Content quality',
      items: [
        [words.length >= 250 && words.length <= 900, `Length: ${words.length} words (ideal 250–900)`],
        [bullets.length >= 5, `${bullets.length} bullet points detected (aim for 5+)`],
        [bullets.length === 0 || bullets.filter(isActionVerb).length / bullets.length >= 0.6, 'Bullets start with action verbs'],
        [(t.match(/\d+%|\$\d|\d{2,}/g) || []).length >= 3, 'Contains measurable results (numbers, %)'],
        [!/\b(I|my|me)\b/.test(t), 'No first-person pronouns'],
      ],
    },
    {
      name: 'Parsing & formatting',
      items: [
        [!/[─-╿▀-▟]/.test(t) && !/\t{2,}/.test(t), 'No table / box-drawing characters'],
        [(t.match(/[^\x00-\x7F•–—’‘“”é€£]/g) || []).length < 15, 'Few unusual symbols or icons'],
        [has(/(19|20)\d{2}/), 'Dates detected for roles'],
        [words.length > 50, 'Text is selectable (not an image-only file)'],
      ],
    },
  ];
  const all = groups.flatMap(g => g.items);
  const score = Math.round((all.filter(([ok]) => ok).length / all.length) * 100);
  return { score, groups, wordCount: words.length };
}

const STOP = new Set(`a about above across after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each etc few for from further get had has have having he her here hers him his how i if in into is it its just like make may more most must my no nor not now of off on once only or other our ours out over own per plus same she should so some such than that the their them then there these they this those through to too under until up us use using very via was we well were what when where which while who whom why will with within without would you your yours ability able candidate candidates company team teams role work working job position looking join including include includes strong excellent good great new year years experience experienced requirements required preferred responsibilities qualifications skills skill knowledge understanding etc. e.g. ie across day based hiring hire plus seeking ideal opportunity apply applicant applicants environment ensure help want need needs least minimum bonus nice`.split(/\s+/));

const PHRASES = ['machine learning', 'data analysis', 'project management', 'product management', 'customer service', 'user research', 'design systems', 'cross-functional', 'stakeholder management', 'a/b testing', 'ci/cd', 'rest api', 'react native', 'node.js', 'google analytics', 'power bi', 'deep learning', 'natural language processing', 'computer vision', 'agile', 'scrum', 'sql', 'python', 'java', 'javascript', 'typescript', 'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'figma', 'excel', 'salesforce', 'seo', 'content strategy', 'financial modeling', 'budgeting', 'forecasting', 'supply chain', 'risk management', 'people management', 'public speaking', 'communication', 'leadership', 'problem solving'];

const stem = w => w.replace(/(ing|ed|es|s|er|ment|ion|ions)$/i, '');

function tokens(text) {
  return (text.toLowerCase().match(/[a-z][a-z0-9+#./-]*[a-z0-9+#]|[a-z]/g) || []).filter(w => w.length > 2 && !STOP.has(w));
}

/** Extract weighted keywords from a job description. */
export function extractKeywords(jd, limit = 30) {
  const lower = jd.toLowerCase();
  const counts = new Map();
  PHRASES.forEach(ph => {
    const n = lower.split(ph).length - 1;
    if (n) counts.set(ph, n * 3);
  });
  tokens(jd).forEach(w => {
    if ([...counts.keys()].some(k => k.includes(' ') && k.split(' ').includes(w))) return;
    counts.set(w, (counts.get(w) || 0) + 1);
  });
  // Capitalized terms in the original text (tools, proper nouns) get a boost.
  (jd.match(/\b[A-Z][a-zA-Z0-9+#.]{1,}\b/g) || []).forEach(w => {
    const k = w.toLowerCase();
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, w]) => ({ term: k, weight: w }));
}

export function matchJob(resumeText, jd) {
  const kws = extractKeywords(jd);
  const rt = resumeText.toLowerCase();
  const rStems = new Set(tokens(resumeText).map(stem));
  const result = { matched: [], partial: [], missing: [] };
  kws.forEach(k => {
    if (rt.includes(k.term)) result.matched.push(k);
    else if (k.term.split(' ').some(part => rStems.has(stem(part)))) result.partial.push(k);
    else result.missing.push(k);
  });
  const total = kws.reduce((s, k) => s + k.weight, 0) || 1;
  const got = result.matched.reduce((s, k) => s + k.weight, 0) + result.partial.reduce((s, k) => s + k.weight * 0.5, 0);
  result.score = Math.round((got / total) * 100);
  return result;
}

