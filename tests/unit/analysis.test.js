import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { coachResume, coachLetter, atsCheck, extractKeywords, matchJob, strengthenBullet, isActionVerb } from '../../js/analysis.js';
import { sampleResume, sampleLetter, blankResume, blankLetter, resumeToText } from '../../js/data.js';

const emptyPersonal = d => { d.personal = Object.fromEntries(Object.keys(d.personal).map(k => [k, ''])); return d; };

describe('coachResume', () => {
  test('a strong CV scores high and an empty one scores low', () => {
    const strong = coachResume(sampleResume('classic')).score;
    const empty = coachResume(emptyPersonal(blankResume())).score;
    assert.ok(strong >= 85, `strong: ${strong}`);
    assert.ok(empty <= 35, `empty: ${empty}`);
  });

  test('score is always 0–100 and each check has a message', () => {
    for (const r of [sampleResume(), blankResume()]) {
      const { score, checks } = coachResume(r);
      assert.ok(score >= 0 && score <= 100);
      for (const c of checks) { assert.equal(typeof c.ok, 'boolean'); assert.ok(c.text.length > 3); }
    }
  });

  test('flags weak openers, missing numbers and first-person wording', () => {
    const r = sampleResume('classic');
    r.experience[0].bullets = 'Responsible for the team\nI worked on things\nHelped with stuff';
    const failed = coachResume(r).checks.filter(c => !c.ok).map(c => c.text).join(' | ');
    assert.match(failed, /weak phrases/);
    assert.match(failed, /first-person/);
  });

  test('warns that two-column templates can confuse ATS parsers', () => {
    const tip = /single-column template/;
    assert.ok(coachResume(sampleResume('modern')).checks.some(c => !c.ok && tip.test(c.text)));
    assert.ok(coachResume(sampleResume('classic')).checks.every(c => c.ok || !tip.test(c.text)));
  });
});

describe('strengthenBullet', () => {
  test('rewrites weak openers and tidies the bullet', () => {
    assert.equal(strengthenBullet('Responsible for the design team.'), 'Managed the design team');
    assert.equal(strengthenBullet('worked on the billing flow'), 'Developed the billing flow');
    assert.equal(strengthenBullet('helped to launch the app'), 'Contributed to launch the app');
  });

  test('leaves a strong bullet alone', () => {
    assert.equal(strengthenBullet('Led redesign, increasing activation by 23%'), 'Led redesign, increasing activation by 23%');
  });

  test('isActionVerb recognises listed verbs and past-tense verbs', () => {
    assert.ok(isActionVerb('Led a team'));
    assert.ok(isActionVerb('Refurbished the lab'));
    assert.equal(isActionVerb('Responsible for things'), false);
  });
});

describe('coachLetter', () => {
  test('the sample letter passes most checks; an empty one does not', () => {
    assert.ok(coachLetter(sampleLetter()).score > coachLetter(emptyPersonal(blankLetter())).score + 30);
  });

  test('flags leftover placeholders from an unedited draft', () => {
    const l = sampleLetter();
    l.body = 'I am applying for the [Job Title] position at [Company].';
    assert.ok(coachLetter(l).checks.some(c => !c.ok && /placeholders/.test(c.text)));
  });

  test('allows a longer letter when it has sub-headings', () => {
    const para = `${'word '.repeat(60)}23%.`;
    const l = sampleLetter();
    l.body = Array.from({ length: 7 }, (_, i) => `# Heading ${i}\n${para}`).join('\n\n');
    const lengthCheck = coachLetter(l).checks.find(c => /^Length is/.test(c.text));
    assert.ok(lengthCheck.ok, lengthCheck.text);
  });
});

describe('atsCheck', () => {
  test('a complete CV scores high', () => {
    const { score, groups, wordCount } = atsCheck(resumeToText(sampleResume()));
    assert.ok(score >= 75, `score ${score}`);
    assert.equal(groups.length, 4);
    assert.ok(wordCount > 100);
  });

  test('empty or junk text scores low without throwing', () => {
    for (const text of ['', undefined, '   ', '!!!', '┌──┐\n│xx│']) assert.ok(atsCheck(text).score <= 50);
  });

  test('finds contact details and standard headings', () => {
    const r = atsCheck('Jane Doe\njane@example.com | +49 151 2345678\nEXPERIENCE\nEDUCATION\nSKILLS\nSUMMARY');
    const flat = Object.fromEntries(r.groups.flatMap(g => g.items).map(([ok, label]) => [label, ok]));
    assert.equal(flat['Email address found'], true);
    assert.equal(flat['Phone number found'], true);
    assert.equal(flat['Experience section heading'], true);
    assert.equal(flat['Skills section heading'], true);
  });
});

describe('job matcher', () => {
  const JD = 'We are hiring a Product Designer with Figma, design systems, user research and SQL. Python is a plus.';

  test('extractKeywords keeps skills and drops filler words', () => {
    const terms = extractKeywords(JD).map(k => k.term);
    for (const t of ['figma', 'design systems', 'user research', 'sql', 'python']) assert.ok(terms.includes(t), t);
    for (const t of ['hiring', 'plus', 'with', 'the']) assert.equal(terms.includes(t), false, t);
  });

  test('sorts keywords into matched, partial and missing', () => {
    const m = matchJob(resumeToText(sampleResume()), JD);
    const names = list => list.map(k => k.term);
    assert.ok(names(m.matched).includes('figma'));
    assert.ok(names(m.matched).includes('design systems'));
    assert.ok(names(m.missing).includes('sql'));
    assert.ok(names(m.missing).includes('python'));
    assert.ok(m.score > 0 && m.score < 100);
  });

  test('scores 100 for a CV that is the job ad and 0 for an unrelated one', () => {
    assert.equal(matchJob(JD, JD).score, 100);
    assert.equal(matchJob('Baker with ten years of sourdough experience.', JD).score, 0);
  });

  test('handles an empty job description', () => {
    const m = matchJob('anything', '');
    assert.equal(m.score, 0);
    assert.deepEqual([m.matched, m.partial, m.missing], [[], [], []]);
  });
});
