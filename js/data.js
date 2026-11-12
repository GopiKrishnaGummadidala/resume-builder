// Data model: document shapes, defaults, validation and sample content. No DOM or storage access here.

export const uid = () => Math.random().toString(36).slice(2, 10);

export const THEME_COLORS = ['#3b8186', '#2563eb', '#0f766e', '#7c3aed', '#be123c', '#c2410c', '#334155', '#4d7c0f'];

export const FONTS = [
  { id: 'hind', label: 'Hind', css: "'Hind', system-ui, sans-serif" },
  { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'source', label: 'Source Sans', css: "'Source Sans 3', system-ui, sans-serif" },
  { id: 'lora', label: 'Lora (serif)', css: "'Lora', Georgia, serif" },
  { id: 'merri', label: 'Merriweather', css: "'Merriweather', Georgia, serif" },
];

/** Template ids the model accepts. templates.js renders exactly these (enforced by a unit test). */
export const TEMPLATE_IDS = ['banner', 'classic', 'minimal', 'executive', 'tech', 'modern', 'compact'];
export const DEFAULT_TEMPLATE = 'banner';
export const DEFAULT_THEME = () => ({ color: THEME_COLORS[0], font: 'hind' });
const EMPTY_PERSONAL = { name: '', title: '', email: '', phone: '', location: '', website: '', linkedin: '', github: '' };

// Optional per-user defaults from js/profile.local.js (git-ignored; see profile.example.js).
// If the file is missing, new documents start with empty details.
let localProfile = {};
try {
  localProfile = (await import('./profile.local.js')).default || {};
} catch { /* no local profile */ }
export const DEFAULT_PERSONAL = Object.freeze(
  Object.fromEntries(Object.keys(EMPTY_PERSONAL).map(k => [k, String(localProfile[k] ?? '')]))
);
const blankPersonal = () => ({ ...DEFAULT_PERSONAL });

/** "5 November, 2026" */
export function formatDate(d = new Date()) {
  return `${d.getDate()} ${d.toLocaleString('en-GB', { month: 'long' })}, ${d.getFullYear()}`;
}

export function blankResume(templateId = DEFAULT_TEMPLATE) {
  return {
    id: uid(),
    type: 'resume',
    title: 'Untitled CV',
    updatedAt: Date.now(),
    templateId,
    theme: DEFAULT_THEME(),
    personal: blankPersonal(),
    summary: '',
    experience: [],
    education: [],
    skills: '',
    projects: [],
    certifications: '',
    languages: '',
  };
}

export function sampleResume(templateId = DEFAULT_TEMPLATE) {
  return {
    ...blankResume(templateId),
    title: 'Sample — Product Designer',
    personal: {
      name: 'Jordan Rivera',
      title: 'Senior Product Designer',
      email: 'jordan.rivera@example.com',
      phone: '+1 555 0142',
      location: 'Austin, TX',
      website: 'jordanrivera.design',
      linkedin: 'linkedin.com/in/jordanrivera',
      github: 'github.com/jrivera',
    },
    summary:
      'Product designer with 7 years of experience shipping B2B SaaS products. Leads research-driven redesigns that lift activation and retention, and partners closely with engineering to build scalable design systems.',
    experience: [
      {
        id: uid(), role: 'Senior Product Designer', company: 'Brightline Analytics', location: 'Austin, TX',
        start: '2021', end: 'Present',
        bullets: [
          'Led redesign of onboarding flow, increasing 7-day activation by 23%',
          'Built a component library of 120+ components adopted by 4 product teams',
          'Ran 40+ user interviews per quarter to prioritize the roadmap with PMs',
          'Mentored 3 junior designers through structured critique sessions',
        ].join('\n'),
      },
      {
        id: uid(), role: 'Product Designer', company: 'Northwind Labs', location: 'Remote',
        start: '2018', end: '2021',
        bullets: [
          'Designed self-serve billing that reduced support tickets by 31%',
          'Partnered with engineering to cut design-to-dev handoff time in half',
          'Launched accessibility audit bringing core flows to WCAG 2.1 AA',
        ].join('\n'),
      },
    ],
    education: [
      { id: uid(), degree: 'B.A. Interaction Design', school: 'University of Texas', location: 'Austin, TX', start: '2014', end: '2018', details: 'Graduated with honors' },
    ],
    skills: 'Figma, Design Systems, User Research, Prototyping, Usability Testing, HTML/CSS, Accessibility, Journey Mapping',
    projects: [
      { id: uid(), name: 'Open-source icon set', link: 'github.com/jrivera/icons', description: '300+ icons used by 2k+ developers' },
    ],
    certifications: 'Nielsen Norman UX Certification (2022)',
    languages: 'English (native), Spanish (professional)',
  };
}

/** Name a new cover letter has until a recipient is entered. */
export const LETTER_TITLE = 'Untitled cover letter';
/** "Cover Letter - <company, or recipient name>"; '' while the "To" details are empty. */
export function letterTitle(letter) {
  const to = (letter.recipient?.company || letter.recipient?.name || '').trim();
  return to ? `Cover Letter - ${to}` : '';
}

export function blankLetter(templateId = DEFAULT_TEMPLATE, fromResume = null) {
  const personal = fromResume ? { ...blankPersonal(), ...fromResume.personal } : blankPersonal();
  return {
    id: uid(),
    type: 'cover',
    title: LETTER_TITLE,
    updatedAt: Date.now(),
    templateId: fromResume ? fromResume.templateId : templateId,
    theme: fromResume ? { ...fromResume.theme } : DEFAULT_THEME(),
    personal,
    recipient: { name: '', title: '', company: '', address: '' },
    job: { role: '', source: '' },
    date: formatDate(),
    greeting: 'Dear Hiring Manager,',
    body: '',
    closing: 'Sincerely,',
  };
}

export function sampleLetter() {
  const l = blankLetter(DEFAULT_TEMPLATE, sampleResume());
  l.title = 'Sample — Cover letter for Acme';
  l.recipient = { name: 'Ms. Chen', title: '', company: '', address: '' };
  l.job = { role: 'Lead Product Designer', source: 'your careers page' };
  l.greeting = 'Dear Ms. Chen,';
  l.body = [
    'With 7 years of experience designing B2B SaaS products, I am applying for the Lead Product Designer position at Acme Corp. Research-driven design, close collaboration with engineering and mentoring other designers is the kind of work I am looking for.',
    '# Research and Product Design',
    'At Brightline Analytics, I led the redesign of our onboarding flow, increasing 7-day activation by 23%. I run 40+ user interviews per quarter and turn the findings into roadmap priorities together with product managers.',
    '# Design Systems',
    'I built a component library of 120+ components adopted by four product teams, and cut design-to-development handoff time in half at Northwind Labs.',
    '# Accessibility',
    'I led an accessibility audit that brought our core flows to WCAG 2.1 AA, and I treat accessibility as a default rather than a final check.',
    'I would welcome the chance to discuss how I can contribute to Acme Corp. Thank you for your time and consideration.',
  ].join('\n\n');
  return l;
}

/** Draft a cover letter body from resume content + target job (template-based, no external AI). */
export function draftLetterBody(resume, letter) {
  const p = resume?.personal || letter.personal;
  const role = letter.job.role || '[Job Title]';
  const company = letter.recipient.company || '[Company]';
  const source = letter.job.source ? `, which I found on ${letter.job.source}` : '';
  const latest = resume?.experience?.[0];
  const years = estimateYears(resume);
  const skills = splitList(resume?.skills).slice(0, 4);
  const intro = `I am excited to apply for the ${role} position at ${company}${source}. ${
    p.title ? `As a ${p.title}${years ? ` with ${years} years of experience` : ''}` : 'With my background'
  }, I am confident I can contribute from day one.`;
  let middle = '';
  if (latest) {
    const wins = splitLines(latest.bullets).slice(0, 2).map(lowerFirst);
    middle = `In my current role as ${latest.role} at ${latest.company}, I ${wins.length ? wins.join(', and ') : 'deliver results across the team'}.`;
  }
  if (skills.length) middle += `${middle ? ' ' : ''}My strengths in ${joinNatural(skills)} align closely with what the ${role} role requires.`;
  const outro = `I would welcome the opportunity to discuss how I can help ${company} reach its goals. Thank you for your time and consideration.`;
  return [intro, middle, outro].filter(Boolean).join('\n\n');
}

function estimateYears(r) {
  if (!r?.experience?.length) return 0;
  const yrs = r.experience.flatMap(e => [e.start, e.end]).map(v => (/present|current/i.test(v || '') ? new Date().getFullYear() : parseInt((v || '').match(/\d{4}/)?.[0], 10))).filter(Boolean);
  if (yrs.length < 2) return 0;
  return Math.max(...yrs) - Math.min(...yrs);
}
const lowerFirst = s => s.charAt(0).toLowerCase() + s.slice(1).replace(/[.;]$/, '');
const joinNatural = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);

/** Convert a resume into plain text (used by ATS checker and job matcher). */
export function resumeToText(r) {
  const p = r.personal;
  const lines = [p.name, p.title, [p.email, p.phone, p.location, p.website, p.linkedin, p.github].filter(Boolean).join(' | ')];
  if (r.summary) lines.push('', 'SUMMARY', r.summary);
  if (r.experience.length) {
    lines.push('', 'EXPERIENCE');
    r.experience.forEach(e => {
      lines.push(`${e.role} — ${e.company} (${e.start} – ${e.end})`);
      splitLines(e.bullets).forEach(b => lines.push(`• ${b}`));
    });
  }
  if (r.education.length) {
    lines.push('', 'EDUCATION');
    r.education.forEach(e => lines.push(`${e.degree}, ${e.school} (${e.start} – ${e.end}) ${e.details || ''}`));
  }
  if (r.skills) lines.push('', 'SKILLS', r.skills);
  if (r.projects.length) {
    lines.push('', 'PROJECTS');
    r.projects.forEach(pr => lines.push(`${pr.name} ${pr.link || ''} — ${pr.description || ''}`));
  }
  if (r.certifications) lines.push('', 'CERTIFICATIONS', r.certifications);
  if (r.languages) lines.push('', 'LANGUAGES', r.languages);
  return lines.join('\n');
}

export const splitLines = s => (s || '').split('\n').map(x => x.trim().replace(/^[-•*]\s*/, '')).filter(Boolean);
export const splitList = s => (s || '').split(/[,\n]/).map(x => x.trim()).filter(Boolean);

// ---------- validation ----------
// Everything that enters the app from outside (localStorage, an imported JSON file) passes through
// normalizeDoc, so the rest of the code can rely on the shape and on values being plain strings.

const LIMITS = { short: 300, long: 5000, body: 20000, items: 50 };
// Text comes from strings; numbers and booleans are converted; anything else (objects, arrays) becomes ''.
const str = (v, max = LIMITS.short) =>
  (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '').slice(0, max);
const validId = v => typeof v === 'string' && /^[a-z0-9]{4,16}$/.test(v);
const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const pick = (src, keys, max) => Object.fromEntries(keys.map(k => [k, str(obj(src)[k], max)]));
const list = (v, keys, longKeys = []) =>
  (Array.isArray(v) ? v : []).slice(0, LIMITS.items).map(item => {
    const it = obj(item); // junk entries (null, strings) become empty items instead of crashing
    return {
      id: validId(it.id) ? it.id : uid(),
      ...pick(it, keys),
      ...pick(it, longKeys, LIMITS.long),
    };
  });

/** Return a clean copy of a CV or cover letter, or null if `raw` is not a document at all. */
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!raw.personal && !raw.theme && !raw.title) return null;
  const theme = obj(raw.theme);
  const base = {
    id: validId(raw.id) ? raw.id : uid(),
    type: raw.type === 'cover' ? 'cover' : 'resume',
    title: str(raw.title) || 'Untitled',
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    templateId: TEMPLATE_IDS.includes(raw.templateId) ? raw.templateId : DEFAULT_TEMPLATE,
    theme: {
      color: typeof theme.color === 'string' && /^#[0-9a-f]{6}$/i.test(theme.color) ? theme.color : THEME_COLORS[0],
      font: FONTS.some(f => f.id === theme.font) ? theme.font : 'hind',
    },
    personal: pick(raw.personal, Object.keys(EMPTY_PERSONAL)),
  };
  if (base.type === 'cover') {
    return {
      ...base,
      recipient: pick(raw.recipient, ['name', 'title', 'company', 'address']),
      job: pick(raw.job, ['role', 'source']),
      date: str(raw.date),
      greeting: str(raw.greeting),
      body: str(raw.body, LIMITS.body),
      closing: str(raw.closing),
    };
  }
  return {
    ...base,
    summary: str(raw.summary, LIMITS.long),
    experience: list(raw.experience, ['role', 'company', 'location', 'start', 'end'], ['bullets']),
    education: list(raw.education, ['degree', 'school', 'location', 'start', 'end'], ['details']),
    skills: str(raw.skills, LIMITS.long),
    projects: list(raw.projects, ['name', 'link'], ['description']),
    certifications: str(raw.certifications, LIMITS.long),
    languages: str(raw.languages, LIMITS.long),
  };
}
