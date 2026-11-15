// Quick tailor: no AI, nothing leaves the browser. It builds the same kind of plan an AI gives
// (js/tailor.js TAILOR_SCHEMA), so the review and the documents work the same way. It only reorders:
// the skills the job asks for come first, and in each job the bullets that match the job's keywords
// move up. Nothing is reworded. The cover letter is the app's template draft for this CV and job.
import { extractKeywords, matchJob } from './analysis.js';
import { resumeToText, draftLetterBody, blankLetter, splitLines, splitList } from './data.js';

/** How strongly a text matches the job's keywords (weighted). */
const scorer = keywords => text => {
  const t = String(text).toLowerCase().replace(/\*\*/g, '');
  return keywords.reduce((s, k) => s + (t.includes(k.term) ? k.weight : 0), 0);
};
/** Highest score first; equal scores keep their order. */
const byScore = (items, score) => items.map((x, i) => ({ x, i, w: score(x) })).sort((a, b) => b.w - a.w || a.i - b.i).map(o => o.x);

/** @param {object} doc a CV  @param {{description: string, company?: string, role?: string}} job */
export function quickPlan(doc, job) {
  const keywords = extractKeywords(job.description, 40);
  const score = scorer(keywords);

  const experience = (doc.experience || []).map(e => {
    const bullets = splitLines(e.bullets || '');
    const ordered = byScore(bullets, score);
    return ordered.join('\n') === bullets.join('\n') ? null : { id: e.id, bullets: ordered };
  }).filter(Boolean);

  const letter = blankLetter(doc.templateId, doc);
  letter.job.role = job.role || 'advertised';
  letter.recipient.company = job.company || 'your company';
  const paragraphs = draftLetterBody(doc, letter).split(/\n{2,}/).map(p => p.trim()).filter(Boolean);

  const match = matchJob(resumeToText(doc), job.description);
  return {
    job: { company: job.company || '', role: job.role || '' },
    headline: doc.personal?.title || '',
    summary: doc.summary || '',
    experience,
    skills: byScore(splitList(doc.skills), score),
    cover_letter: { greeting: 'Dear Hiring Manager,', paragraphs, closing: 'Kind regards,' },
    matched_keywords: match.matched.map(k => k.term).slice(0, 12),
    // The company's own name is in the ad, not a skill to have.
    missing_keywords: match.missing.map(k => k.term).filter(t => !String(job.company || '').toLowerCase().includes(t)).slice(0, 10),
    notes: [
      'Quick tailor: the skills and bullets that match the job come first. Nothing was reworded.',
      'The cover letter is a short template draft from your CV; read it and make it yours, or pick an AI for a written one.',
    ],
  };
}
