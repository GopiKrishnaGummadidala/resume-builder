// Tailoring: the prompt, and the checks that keep a tailored CV true to the original.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sampleResume } from '../../js/data.js';
import { tailorPrompt, copyPrompt, parseReply, reviewPlan, buildTailored, buildLetter, TAILOR_SCHEMA } from '../../js/tailor.js';

const cv = () => sampleResume('signature');
/** A plan that keeps everything, so a test changes only what it is about. */
function plan(doc, over = {}) {
  return {
    job: { company: 'Contoso', role: 'Senior Product Designer' },
    headline: doc.personal.title,
    summary: doc.summary,
    experience: [],
    skills: doc.skills.split(', '),
    cover_letter: { greeting: 'Dear Hiring Manager,', paragraphs: [], closing: 'Kind regards,' },
    matched_keywords: [],
    missing_keywords: [],
    notes: [],
    ...over,
  };
}
const LETTER = [
  'I am applying for the Senior Product Designer role at Contoso, after 7 years of designing B2B SaaS products.',
  'At Brightline Analytics I built a component library of 120+ components that 4 product teams use.',
  'I would be glad to talk about the role. Thank you for your time.',
];

describe('prompt', () => {
  test('holds the CV content and the job, never the name, contact details or photo', () => {
    const doc = { ...cv(), personal: { ...cv().personal, photo: 'data:image/jpeg;base64,AAAA' } };
    const { system, user } = tailorPrompt(doc, { description: 'We need a designer.', company: 'Contoso' });
    assert.match(system, /Use only what the CV says/);
    assert.match(user, /We need a designer\./);
    assert.match(user, /Brightline Analytics/);
    for (const secret of ['Jordan Rivera', 'jordan.rivera@example.com', '+1 555 0142', 'data:image']) assert.equal(user.includes(secret), false, secret);
  });

  test('asks for the letter in the job ad\'s language only when chosen', () => {
    assert.match(tailorPrompt(cv(), { description: 'x' }).user, /Cover letter language: the CV's language/);
    assert.match(tailorPrompt(cv(), { description: 'x', letterLanguage: 'job' }).user, /the job description's language/);
  });

  test('the copy-and-paste prompt carries the answer format', () => {
    const text = copyPrompt(cv(), { description: 'We need a designer.' });
    assert.match(text, /Reply with only one JSON object/);
    assert.ok(text.includes(JSON.stringify(TAILOR_SCHEMA)));
  });

  test('an AI answer is read even inside a code fence or a sentence', () => {
    assert.deepEqual(parseReply('Here you go:\n```json\n{"summary":"x"}\n```'), { summary: 'x' });
    assert.throws(() => parseReply('Sorry, I cannot help.'), /no JSON object/);
    assert.throws(() => parseReply('{"summary": oops}'), /not valid/);
  });
});

describe('reviewPlan keeps the CV true', () => {
  test('a rewrite that invents a number is left out; one with the CV\'s own numbers is kept', () => {
    const doc = cv();
    const [first, second] = doc.experience;
    const r = reviewPlan(doc, plan(doc, {
      experience: [
        { id: first.id, bullets: first.bullets.split('\n').reverse() },
        { id: second.id, bullets: ['Designed self-serve billing that reduced support tickets by 35%', 'Partnered with engineering', 'Launched an accessibility audit'] },
      ],
    }));
    assert.deepEqual(r.changes.map(c => c.key), [`job:${first.id}`]);
    assert.match(r.rejected[0].reason, /35.*your CV does not say/);
  });

  test('skills are only reordered: unknown ones are dropped, none of the CV\'s is lost', () => {
    const doc = cv();
    const r = reviewPlan(doc, plan(doc, { skills: ['Accessibility', 'Figma', 'Kubernetes'] }));
    const skills = r.changes.find(c => c.key === 'skills').after.split(', ');
    assert.deepEqual(skills.slice(0, 2), ['Accessibility', 'Figma']);
    assert.deepEqual([...skills].sort(), doc.skills.split(', ').sort());
    assert.match(r.rejected.find(x => x.label === 'Skills').reason, /Kubernetes/);
  });

  test('a job that would lose most of its bullets, or gain new ones, is left as it was', () => {
    const doc = cv();
    const job = doc.experience[0]; // 4 bullets
    const fewer = reviewPlan(doc, plan(doc, { experience: [{ id: job.id, bullets: ['Mentored 3 junior designers'] }] }));
    assert.equal(fewer.changes.length, 0);
    assert.match(fewer.rejected[0].reason, /keeps 1 of 4/);
    const more = reviewPlan(doc, plan(doc, { experience: [{ id: job.id, bullets: [...job.bullets.split('\n'), 'a', 'b'] }] }));
    assert.match(more.rejected[0].reason, /adds bullets/);
  });

  test('jobs are matched by id; an unknown id changes nothing', () => {
    const doc = cv();
    const r = reviewPlan(doc, plan(doc, { experience: [{ id: 'nope1234', bullets: ['x'] }] }));
    assert.equal(r.changes.length, 0);
  });

  test('the cover letter must use the CV\'s numbers, have no placeholders and stay short', () => {
    const doc = cv();
    const ok = reviewPlan(doc, plan(doc, { cover_letter: { greeting: 'Dear Ms. Chen,', paragraphs: LETTER, closing: 'Kind regards,' } }));
    const letter = ok.changes.find(c => c.key === 'letter');
    assert.equal(letter.greeting, 'Dear Ms. Chen,');
    assert.equal(letter.after.length, 3);
    const invented = reviewPlan(doc, plan(doc, { cover_letter: { greeting: 'Hi', paragraphs: [...LETTER, 'I grew revenue by 85%.'], closing: 'Bye' } }));
    assert.equal(invented.changes.some(c => c.key === 'letter'), false);
    const placeholder = reviewPlan(doc, plan(doc, { cover_letter: { greeting: 'Hi', paragraphs: ['I want to join [Company].'], closing: 'Bye' } }));
    assert.match(placeholder.rejected[0].reason, /placeholder/);
    const long = reviewPlan(doc, plan(doc, { cover_letter: { greeting: 'Hi', paragraphs: [Array(400).fill('word').join(' ')], closing: 'Bye' } }));
    assert.match(long.rejected[0].reason, /fit one page/);
  });

  test('reports the company and role the AI read in the job ad', () => {
    const doc = cv();
    assert.deepEqual(reviewPlan(doc, plan(doc)).found, { company: 'Contoso', role: 'Senior Product Designer' });
  });
});

describe('the tailored documents', () => {
  test('a tailored CV is a copy: new id, accepted changes, tags and template; the original is unchanged', () => {
    const doc = cv();
    const before = JSON.stringify(doc);
    const r = reviewPlan(doc, plan(doc, { summary: 'Designer with **7 years** in B2B SaaS.', skills: ['Accessibility'] }));
    const copy = buildTailored(doc, r.changes.filter(c => c.key === 'summary'), { company: 'Contoso', templateId: 'horizon' });
    assert.notEqual(copy.id, doc.id);
    assert.equal(copy.summary, 'Designer with **7 years** in B2B SaaS.');
    assert.equal(copy.skills, doc.skills, 'a change not accepted is not applied');
    assert.equal(copy.templateId, 'horizon');
    assert.deepEqual(copy.tags, ['Tailored', 'Contoso']);
    assert.match(copy.title, /– Contoso$/);
    assert.equal(JSON.stringify(doc), before);
  });

  test('the cover letter goes with its CV: same details, the job, its own template', () => {
    const doc = cv();
    const change = reviewPlan(doc, plan(doc, { cover_letter: { greeting: 'Dear Ms. Chen,', paragraphs: LETTER, closing: 'Kind regards,' } }))
      .changes.find(c => c.key === 'letter');
    const tailored = buildTailored(doc, [], { company: 'Contoso' });
    const letter = buildLetter(tailored, change, { company: 'Contoso', role: 'Senior Product Designer', letterTemplateId: 'classic' });
    assert.equal(letter.type, 'cover');
    assert.equal(letter.templateId, 'classic');
    assert.equal(letter.personal.name, doc.personal.name);
    assert.equal(letter.recipient.company, 'Contoso');
    assert.equal(letter.title, 'Cover Letter - Contoso');
    assert.equal(letter.body.split('\n\n').length, 3);
    assert.deepEqual(letter.tags, tailored.tags);
  });
});
