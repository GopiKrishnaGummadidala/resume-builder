import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDoc, blankResume, blankLetter, sampleResume, sampleLetter, draftLetterBody, resumeToText,
  formatDate, splitLines, splitList, TEMPLATE_IDS, DEFAULT_TEMPLATE, THEME_COLORS, FONTS, LETTER_TITLE, letterTitle,
  PAGE_SIZES, SPACING_STEPS, MARGIN_STEPS, DEFAULT_SPACING, DEFAULT_MARGIN, pageSize, pageScale, validPhoto, PHOTO_MAX_CHARS,
} from '../../js/data.js';
import { TEMPLATES } from '../../js/templates.js';

describe('normalizeDoc', () => {
  test('rejects values that are not documents', () => {
    for (const v of [null, undefined, 1, 'x', [], {}, { foo: 'bar' }]) assert.equal(normalizeDoc(v), null);
  });

  test('a clean document passes through unchanged', () => {
    for (const d of [sampleResume(), sampleLetter(), blankResume(), blankLetter()]) {
      assert.deepEqual(normalizeDoc(structuredClone(d)), d);
    }
  });

  test('replaces unsafe or unknown presentation values with defaults', () => {
    const d = normalizeDoc({ title: 'x', templateId: '../evil', theme: { color: 'red;background:url(//evil)', font: 'comic' } });
    assert.equal(d.templateId, DEFAULT_TEMPLATE);
    assert.equal(d.theme.color, THEME_COLORS[0]);
    assert.equal(d.theme.font, 'hind');
  });

  test('coerces every field to a string and drops unknown fields', () => {
    const d = normalizeDoc({ title: 7, personal: { name: { evil: true }, email: null, extra: 'x' }, summary: ['a'], __proto__: { polluted: true }, onload: 'alert(1)' });
    assert.equal(d.title, '7');
    assert.equal(d.personal.name, '', 'objects are not turned into text');
    assert.equal(normalizeDoc({ title: 'x', personal: { name: { toString: 'boom' } } }).personal.name, '', 'hostile toString cannot throw');
    assert.equal(d.personal.email, '');
    assert.equal('extra' in d.personal, false);
    assert.equal('onload' in d, false);
    assert.equal(typeof d.summary, 'string');
  });

  test('caps field lengths and list sizes', () => {
    const d = normalizeDoc({
      title: 'x'.repeat(1000), summary: 'y'.repeat(99999),
      experience: Array.from({ length: 500 }, () => ({ role: 'r', bullets: 'b'.repeat(99999) })),
    });
    assert.equal(d.title.length, 300);
    assert.equal(d.summary.length, 5000);
    assert.equal(d.experience.length, 50);
    assert.equal(d.experience[0].bullets.length, 5000);
  });

  test('gives list items valid ids and tolerates junk items', () => {
    const d = normalizeDoc({ title: 'x', experience: [null, 'str', { id: '<script>', role: 'Dev' }], projects: 'nope' });
    assert.equal(d.experience.length, 3);
    for (const e of d.experience) assert.match(e.id, /^[a-z0-9]{4,16}$/);
    assert.equal(d.experience[2].role, 'Dev');
    assert.deepEqual(d.projects, []);
  });

  test('keeps cover-letter fields and no CV fields on a letter', () => {
    const d = normalizeDoc({ type: 'cover', title: 'L', recipient: { name: 'Mr. Brandt' }, body: 'Hello', experience: [{ role: 'x' }] });
    assert.equal(d.type, 'cover');
    assert.equal(d.recipient.name, 'Mr. Brandt');
    assert.equal(d.body, 'Hello');
    assert.equal('experience' in d, false);
  });
});

describe('model', () => {
  test('the model and the renderer agree on the template list', () => {
    assert.deepEqual(TEMPLATES.map(t => t.id), TEMPLATE_IDS);
    assert.ok(TEMPLATE_IDS.includes(DEFAULT_TEMPLATE));
  });

  test('new documents start with the default template, colour and font', () => {
    for (const d of [blankResume(), blankLetter()]) {
      assert.equal(d.templateId, DEFAULT_TEMPLATE);
      assert.equal(d.theme.color, THEME_COLORS[0]);
      assert.ok(FONTS.some(f => f.id === d.theme.font));
      assert.match(d.id, /^[a-z0-9]{4,16}$/);
    }
    assert.notEqual(blankResume().id, blankResume().id);
  });

  test('a letter started from a CV copies its details and design', () => {
    const cv = { ...sampleResume('tech'), theme: { color: '#be123c', font: 'lora', spacing: 5, margin: 2, size: 'letter' } };
    const l = blankLetter(undefined, cv);
    assert.equal(l.personal.name, cv.personal.name);
    assert.equal(l.templateId, 'tech');
    assert.deepEqual(l.theme, cv.theme);
    l.personal.name = 'Changed';
    assert.notEqual(cv.personal.name, 'Changed', 'copies, not shares');
  });

  test('formatDate uses the "5 November, 2026" style', () => {
    assert.equal(formatDate(new Date(2026, 10, 5)), '5 November, 2026');
  });

  test('splitLines and splitList trim, drop blanks and strip bullet marks', () => {
    assert.deepEqual(splitLines('- one\n\n• two \n* three'), ['one', 'two', 'three']);
    assert.deepEqual(splitList('a, b\nc,,  '), ['a', 'b', 'c']);
    assert.deepEqual(splitLines(undefined), []);
  });
});

describe('text output', () => {
  test('resumeToText includes every section with standard headings', () => {
    const text = resumeToText(sampleResume());
    for (const part of ['Jordan Rivera', 'SUMMARY', 'EXPERIENCE', 'EDUCATION', 'SKILLS', 'PROJECTS', 'CERTIFICATIONS', 'LANGUAGES', '• Led redesign']) {
      assert.ok(text.includes(part), `missing ${part}`);
    }
  });

  test('draftLetterBody uses the job, company and CV details', () => {
    const l = blankLetter();
    l.recipient.company = 'Colenet';
    l.job = { role: 'Software Engineer', source: 'LinkedIn' };
    const body = draftLetterBody(sampleResume(), l);
    assert.match(body, /Software Engineer position at Colenet, which I found on LinkedIn/);
    assert.match(body, /Senior Product Designer at Brightline Analytics/);
    assert.equal(body.split('\n\n').length, 3);
  });

  test('draftLetterBody leaves visible placeholders when details are missing', () => {
    const body = draftLetterBody(null, { ...blankLetter(), personal: { name: '', title: '' } });
    assert.match(body, /\[Job Title\]/);
    assert.match(body, /\[Company\]/);
  });
});

describe('letterTitle', () => {
  test('names a letter after the company, else the recipient, else nothing', () => {
    const l = blankLetter();
    assert.equal(l.title, LETTER_TITLE);
    assert.equal(letterTitle(l), '');
    l.recipient.name = ' Mr. Brandt ';
    assert.equal(letterTitle(l), 'Cover Letter - Mr. Brandt');
    l.recipient.company = 'Northwind Labs';
    assert.equal(letterTitle(l), 'Cover Letter - Northwind Labs');
    assert.equal(letterTitle({}), '');
  });
});

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

describe('page settings', () => {
  test('new documents use A4 with the default spacing and margins', () => {
    for (const doc of [blankResume(), blankLetter()]) {
      assert.deepEqual({ size: doc.theme.size, spacing: doc.theme.spacing, margin: doc.theme.margin }, { size: 'a4', spacing: DEFAULT_SPACING, margin: DEFAULT_MARGIN });
      assert.equal(pageSize(doc), PAGE_SIZES.a4);
      assert.deepEqual(pageScale(doc), { spacing: 1, margin: 1 });
    }
  });

  test('documents saved before these settings existed get the defaults', () => {
    const old = { ...sampleResume(), theme: { color: '#2563eb', font: 'inter' } };
    assert.deepEqual(normalizeDoc(old).theme, { color: '#2563eb', font: 'inter', spacing: DEFAULT_SPACING, margin: DEFAULT_MARGIN, size: 'a4' });
    assert.equal(pageSize(old), PAGE_SIZES.a4);
    assert.deepEqual(pageScale(old), { spacing: 1, margin: 1 });
  });

  test('valid settings are kept', () => {
    const doc = normalizeDoc({ ...sampleResume(), theme: { color: '#2563eb', font: 'inter', spacing: 7, margin: 1, size: 'letter' } });
    assert.deepEqual(doc.theme, { color: '#2563eb', font: 'inter', spacing: 7, margin: 1, size: 'letter' });
    assert.deepEqual({ W: pageSize(doc).W, H: pageSize(doc).H }, { W: 816, H: 1056 });
    assert.deepEqual(pageScale(doc), { spacing: SPACING_STEPS[6], margin: MARGIN_STEPS[0] });
  });

  test('invalid settings fall back instead of reaching the page', () => {
    for (const bad of [0, 8, 2.5, '3', -1, null, NaN, { valueOf: () => 3 }, '1;color:red']) {
      const doc = normalizeDoc({ ...sampleResume(), theme: { spacing: bad, margin: bad, size: bad } });
      assert.deepEqual({ size: doc.theme.size, spacing: doc.theme.spacing, margin: doc.theme.margin }, { size: 'a4', spacing: DEFAULT_SPACING, margin: DEFAULT_MARGIN }, String(bad));
    }
    for (const size of ['constructor', '__proto__', 'toString', 'A4']) {
      assert.equal(normalizeDoc({ ...sampleResume(), theme: { size } }).theme.size, 'a4', size);
      assert.equal(pageSize({ theme: { size } }), PAGE_SIZES.a4, size);
    }
  });
});

describe('photo', () => {
  test('an embedded JPEG, PNG or WebP is accepted', () => {
    for (const type of ['jpeg', 'png', 'webp']) {
      const photo = `data:image/${type};base64,AAAA`;
      assert.equal(validPhoto(photo), photo);
    }
    assert.equal(normalizeDoc({ ...sampleResume(), personal: { name: 'A', photo: PHOTO } }).personal.photo, PHOTO);
  });

  test('anything else is dropped', () => {
    const bad = [
      'https://example.com/me.jpg', 'javascript:alert(1)', 'data:text/html;base64,AAAA', 'data:image/svg+xml;base64,AAAA',
      'data:image/jpeg;base64,AA"onerror="alert(1)', 'data:image/jpeg;base64,', 'data:image/jpeg,AAAA', '', null, 42, {}, ['x'],
      `data:image/jpeg;base64,${'A'.repeat(PHOTO_MAX_CHARS)}`,
    ];
    for (const v of bad) {
      assert.equal(validPhoto(v), '', String(v).slice(0, 40));
      assert.equal(normalizeDoc({ ...sampleResume(), personal: { name: 'A', photo: v } }).personal.photo, '');
    }
  });

  test('new documents have an empty photo, and a letter copies the photo of its CV', () => {
    assert.equal(blankResume().personal.photo, '');
    const cv = sampleResume();
    cv.personal.photo = PHOTO;
    assert.equal(blankLetter(undefined, cv).personal.photo, PHOTO);
  });
});
