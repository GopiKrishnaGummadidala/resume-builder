// Import: positioned PDF text runs -> text in reading order -> CV fields.
// The layouts here are made up; they mimic how pdf.js reports a two-column CV (y grows upwards).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { itemsToText, parseResumeText } from '../../js/importer.js';

/** A run of text at (x, y). Width is estimated from the length, which is all the layout step needs. */
const run = (str, x, y, { h = 9, bold = false } = {}) => ({ str, x, y, w: str.length * h * 0.48, h, bold });
/**
 * Runs placed one after another on a line, as a PDF writer splits "Oct, 2021 - Present | Austin":
 * no gap before punctuation, a word space before anything else.
 */
const seq = (x, y, parts, opts) => parts.reduce((acc, str) => {
  const prev = acc[acc.length - 1];
  const at = prev ? prev.x + prev.w + (/^[,.;:]/.test(str) ? 0 : 2.5) : x;
  return [...acc, run(str, at, y, opts)];
}, []);

/** Page 1 of a two-column CV: full-width header, main column at x=22, side column at x=420. */
function twoColumnPage() {
  const items = [
    run('Jordan Rivera', 128, 808, { h: 16, bold: true }),
    run('Senior Product Designer', 128, 792, { h: 11 }),
    run('Product designer with seven years of experience shipping B2B SaaS products and design', 128, 773),
    run('systems, partnering closely with engineering on research-driven redesigns.', 128, 761),
    run('JORDAN.RIVERA@EXAMPLE.COM', 85, 700, { h: 8 }), run('+1 555 0142', 265, 700, { h: 8 }),
    run('Austin, USA', 346, 700, { h: 8 }), run('jordan-rivera', 438, 700, { h: 8 }),
    run('jrivera', 262, 676, { h: 8 }),
    run('WORK EXPERIENCE', 47, 630, { h: 11, bold: true }), run('SKILLS', 444, 630, { h: 11, bold: true }),
    run('Senior Product Designer', 22, 602, { h: 10, bold: true }),
    run('Figma', 424, 599), run('Prototyping', 460, 599),
    run('Brightline Analytics', 22, 589, { h: 10 }),
    run('Analytics platform for mid-size retailers · 300 employees', 22, 577, { h: 8.3 }),
    run('User Research', 424, 573), run('Accessibility', 490, 573),
    ...seq(22, 554, ['Oct', ',', '2021', '-', 'Present', '|', 'Austin, USA']),
    run('Achievements/Tasks', 22, 537, { bold: true }),
    ...seq(30, 525, ['Led the redesign of onboarding'], { bold: true }), ...seq(30 + 30 * 9 * 0.48 + 2.5, 525, ['across web and mobile, lifting']),
    run('7-day activation by 23%.', 30, 513, { bold: true }),
    ...seq(30, 501, ['Built a component library'], { bold: true }), ...seq(30 + 25 * 9 * 0.48 + 2.5, 501, ['of 120 components adopted by four']),
    run('product teams.', 30, 489),
    run('Product Designer', 22, 460, { h: 10, bold: true }),
    run('Northwind Labs', 22, 447, { h: 10 }),
    ...seq(22, 425, ['Jan', ',', '2018', '-', 'Sep', ',', '2021', '|', 'Remote']),
    run('Achievements/Tasks', 22, 408, { bold: true }),
    ...seq(30, 396, ['Designed self-serve billing'], { bold: true }), ...seq(30 + 27 * 9 * 0.48 + 2.5, 396, ['that reduced support tickets by 31%.']),
    run('CERTIFICATES', 444, 224, { h: 11, bold: true }),
    run('Certified Usability Analyst', 420, 196, { h: 10, bold: true }),
    run('Human Factors Intl', 420, 184, { h: 8.3 }),
    ...seq(420, 172, ['Aug', ',', '2020']),
    run('Page 1 of 2', 549, 10, { h: 8 }),
  ];
  return { width: 596, items };
}

function secondPage() {
  return {
    width: 596,
    items: [
      run('EDUCATION', 444, 806, { h: 11, bold: true }),
      run('B.A. Interaction Design', 420, 780, { h: 10, bold: true }),
      run('University of Texas', 420, 767, { h: 10 }),
      ...seq(420, 754, ['May', ',', '2018']),
      run('LANGUAGES', 444, 720, { h: 11, bold: true }),
      run('English', 420, 694, { bold: true }), run('Native or Bilingual Proficiency', 420, 682, { h: 8.3 }),
      run('Spanish', 420, 664, { bold: true }), run('Limited Working Proficiency', 420, 652, { h: 8.3 }),
      run('ACHIEVEMENTS', 444, 620, { h: 11, bold: true }),
      run('Design System Rollout', 420, 594, { h: 10, bold: true }),
      run('Moved four teams onto one', 420, 580, { h: 8.3 }),
      run('component library.', 420, 569, { h: 8.3 }),
      ...seq(420, 556, ['Mar', ',', '2023']),
      run('INTERESTS', 444, 520, { h: 11, bold: true }),
      run('Trail Running', 432, 494), run('Letterpress', 432, 470),
      run('WORK EXPERIENCE', 47, 806, { h: 11, bold: true }),
      run('Junior Designer', 22, 780, { h: 10, bold: true }),
      run('Studio Nine', 22, 767, { h: 10 }),
      ...seq(22, 745, ['Jun', ',', '2016', '-', 'Dec', ',', '2017', '|', 'Austin, USA']),
      run('Page 2 of 2', 549, 10, { h: 8 }),
    ],
  };
}

describe('itemsToText (PDF layout)', () => {
  const text = itemsToText([twoColumnPage(), secondPage()]);
  const lines = text.split('\n');

  test('reads the main column before the side column, never mixing their lines', () => {
    assert.ok(text.indexOf('Brightline Analytics') < text.indexOf('**SKILLS**'));
    assert.ok(lines.every(l => !(l.includes('Brightline') && l.includes('Figma'))), 'a line holds text from both columns');
    assert.ok(text.indexOf('Junior Designer') < text.indexOf('**EDUCATION**'), 'page 2 main column comes before the side columns');
  });

  test('keeps the header, contact row and handles together at the top', () => {
    const top = text.slice(0, text.indexOf('WORK EXPERIENCE'));
    for (const part of ['Jordan Rivera', 'JORDAN.RIVERA@EXAMPLE.COM', 'jordan-rivera', 'jrivera']) assert.ok(top.includes(part), part);
  });

  test('marks bold runs, joins split dates and drops page footers', () => {
    assert.ok(lines.includes('**Senior Product Designer**'));
    assert.ok(text.includes('**Led the redesign of onboarding** across web and mobile, lifting'));
    assert.ok(lines.some(l => l.startsWith('Oct, 2021 - Present | Austin, USA')));
    assert.equal(/page \d of \d/i.test(text), false);
  });

  test('a one-column page is read top to bottom with right-aligned dates on the same line', () => {
    const one = itemsToText([{ width: 596, items: [
      run('Experience', 40, 700, { bold: true }),
      run('Engineer', 40, 680), run('2019 – Present', 480, 680),
      run('Acme GmbH', 40, 668), run('Hamburg', 500, 668),
      run('Second line', 40, 656), run('Third line', 40, 644), run('Fourth line', 40, 632), run('Fifth line', 40, 620),
    ] }]);
    assert.match(one, /^Engineer\t2019 – Present$/m);
    assert.match(one, /^Acme GmbH\tHamburg$/m);
  });

  test('copes with nothing to read', () => {
    assert.equal(itemsToText([]), '');
    assert.equal(itemsToText([{ width: 596, items: [] }]), '');
    assert.equal(itemsToText([{ width: 596, items: [run('  ', 10, 10)] }]), '');
  });
});

describe('parseResumeText on a two-column CV', () => {
  const r = parseResumeText(itemsToText([twoColumnPage(), secondPage()]));

  test('fills the personal details, including handles shown without a site name', () => {
    assert.deepEqual({ ...r.personal, photo: undefined }, {
      name: 'Jordan Rivera', title: 'Senior Product Designer', email: 'jordan.rivera@example.com', phone: '+1 555 0142',
      location: 'Austin, USA', website: '', linkedin: 'linkedin.com/in/jordan-rivera', github: 'github.com/jrivera', photo: undefined,
    });
    assert.match(r.summary, /^Product designer with seven years .* research-driven redesigns\.$/);
  });

  test('finds every job, across pages, with its dates, place and company note', () => {
    assert.deepEqual(r.experience.map(e => [e.role, e.company, e.start, e.end, e.location]), [
      ['Senior Product Designer', 'Brightline Analytics', 'Oct, 2021', 'Present', 'Austin, USA'],
      ['Product Designer', 'Northwind Labs', 'Jan, 2018', 'Sep, 2021', 'Remote'],
      ['Junior Designer', 'Studio Nine', 'Jun, 2016', 'Dec, 2017', 'Austin, USA'],
    ]);
    assert.equal(r.experience[0].about, 'Analytics platform for mid-size retailers · 300 employees');
  });

  test('splits bullets that have no markers, keeping bold, and drops the "Achievements/Tasks" label', () => {
    assert.deepEqual(r.experience[0].bullets.split('\n'), [
      '**Led the redesign of onboarding** across web and mobile, lifting **7-day activation by 23%.**',
      '**Built a component library** of 120 components adopted by four product teams.',
    ]);
    assert.equal(r.experience[1].bullets, '**Designed self-serve billing** that reduced support tickets by 31%.');
    assert.equal(r.experience[2].bullets, '');
  });

  test('fills the side-column sections', () => {
    assert.equal(r.skills, 'Figma, Prototyping, User Research, Accessibility');
    assert.equal(r.certifications, 'Certified Usability Analyst | Human Factors Intl | Aug, 2020');
    assert.equal(r.languages, 'English | Native or Bilingual Proficiency\nSpanish | Limited Working Proficiency');
    assert.deepEqual(r.education.map(e => [e.degree, e.school, e.end]), [['B.A. Interaction Design', 'University of Texas', 'May, 2018']]);
    assert.deepEqual(r.achievements.map(a => [a.title, a.date, a.description]), [['Design System Rollout', 'Mar, 2023', 'Moved four teams onto one component library.']]);
    assert.equal(r.interests, 'Trail Running, Letterpress');
  });

  test('does not borrow this browser\'s default details for an imported CV', () => {
    const empty = parseResumeText('');
    assert.deepEqual(Object.values(empty.personal).filter(Boolean), []);
  });
});

describe('parseResumeText on plain text', () => {
  test('bullets with markers, one job per date line', () => {
    const r = parseResumeText(`Sam Lee
Data Engineer
sam@example.com

Experience
Data Engineer
Acme GmbH
2020 - Present
• Built pipelines for 40 sources
• Cut costs by 20%
Analyst
Beta AG
2017 – 2020
- Wrote the weekly
  revenue report`);
    assert.deepEqual(r.experience.map(e => [e.role, e.company, e.start, e.end, e.bullets]), [
      ['Data Engineer', 'Acme GmbH', '2020', 'Present', 'Built pipelines for 40 sources\nCut costs by 20%'],
      ['Analyst', 'Beta AG', '2017', '2020', 'Wrote the weekly revenue report'],
    ]);
  });

  test('a job written on one line', () => {
    const r = parseResumeText('Sam Lee\n\nExperience\nData Engineer, Acme GmbH 2020 - 2022\n• Built pipelines');
    assert.deepEqual([r.experience[0].role, r.experience[0].company, r.experience[0].start, r.experience[0].end], ['Data Engineer', 'Acme GmbH', '2020', '2022']);
  });

  test('a section heading in capitals or with a colon is recognised', () => {
    const r = parseResumeText('Sam Lee\n\nSKILLS:\nSQL | Python • dbt\n\nInterests\nChess, Cycling');
    assert.equal(r.skills, 'SQL, Python, dbt');
    assert.equal(r.interests, 'Chess, Cycling');
  });
});
