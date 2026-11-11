import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, renderLetter, renderDoc, letterBlocks, esc, TEMPLATES, PAGE } from '../../js/templates.js';
import { sampleResume, sampleLetter, blankLetter, blankResume } from '../../js/data.js';

const XSS = '<img src=x onerror=alert(1)>"\'&';

describe('escaping', () => {
  test('esc neutralises HTML and attribute characters', () => {
    assert.equal(esc(XSS), '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
    assert.equal(esc(null), '');
    assert.equal(esc(42), '42');
  });

  test('no CV field can inject markup, in any template', () => {
    for (const t of TEMPLATES) {
      const r = sampleResume(t.id);
      r.personal = Object.fromEntries(Object.keys(r.personal).map(k => [k, XSS]));
      r.summary = r.skills = r.certifications = r.languages = XSS;
      r.experience[0] = { ...r.experience[0], role: XSS, company: XSS, location: XSS, start: XSS, end: XSS, bullets: XSS };
      r.education[0] = { ...r.education[0], degree: XSS, school: XSS, details: XSS };
      r.projects[0] = { ...r.projects[0], name: XSS, link: XSS, description: XSS };
      const html = renderResume(r);
      assert.equal(html.includes('<img'), false, `${t.id}: raw tag leaked`);
      assert.equal(/onerror=alert\(1\)>/.test(html), false, `${t.id}: handler leaked`);
    }
  });

  test('no cover-letter field can inject markup, editable or not', () => {
    for (const t of TEMPLATES) {
      const l = { ...sampleLetter(), templateId: t.id };
      l.recipient = { name: XSS, title: XSS, company: XSS, address: XSS };
      l.job.role = l.date = l.greeting = l.closing = XSS;
      l.body = `${XSS}\n\n# ${XSS}\n**${XSS}**`;
      for (const opts of [{}, { editable: true }]) {
        const html = renderLetter(l, opts);
        assert.equal(html.includes('<img'), false, `${t.id}: raw tag leaked`);
      }
    }
  });

  test('theme values land inside the style attribute only', () => {
    const r = { ...sampleResume(), theme: { color: '"><script>alert(1)</script>', font: 'hind' } };
    assert.equal(renderResume(r).includes('<script>'), false);
  });
});

describe('letterBlocks', () => {
  test('blank lines split paragraphs; single newlines become line breaks', () => {
    assert.equal(letterBlocks('one\ntwo\n\nthree'), '<p>one<br>two</p><p>three</p>');
  });

  test('"# " lines become sub-headings and **text** becomes bold', () => {
    assert.equal(
      letterBlocks('# Skills\nI know **C#** well.'),
      '<h4 class="l-h">Skills</h4><p>I know <strong>C#</strong> well.</p>'
    );
  });

  test('empty or missing body renders nothing', () => {
    assert.equal(letterBlocks(''), '');
    assert.equal(letterBlocks(undefined), '');
    assert.equal(letterBlocks('\n\n  \n'), '');
  });
});

describe('renderLetter', () => {
  test('always prints "To" and a closing, with fallbacks for empty fields', () => {
    for (const t of TEMPLATES) {
      const l = { ...blankLetter(t.id), closing: '', greeting: '' };
      l.personal.name = '';
      const html = renderLetter(l);
      assert.ok(html.includes('To'), t.id);
      assert.ok(html.includes('Hiring Manager'), t.id);
      assert.ok(html.includes('Dear Hiring Manager,'), t.id);
      assert.ok(html.includes('Sincerely,'), t.id);
      assert.ok(html.includes('Your Name'), t.id);
    }
  });

  test('the recipient replaces the fallback', () => {
    const l = blankLetter();
    l.recipient = { name: 'Mr. Brandt', title: '', company: 'Colenet', address: '' };
    const html = renderLetter(l);
    assert.ok(html.includes('Mr. Brandt<br>Colenet'));
    assert.equal(html.includes('Hiring Manager<'), false);
  });

  test('in-page editing markup appears only when asked for', () => {
    const l = sampleLetter();
    assert.equal(renderLetter(l).includes('contenteditable'), false, 'print/PDF output must not be editable');
    const editable = renderLetter(l, { editable: true });
    for (const field of ['recipient.name', 'date', 'greeting', 'closing']) {
      assert.ok(editable.includes(`data-edit-field="${field}"`), field);
    }
    assert.ok(editable.includes('data-edit="body"'));
  });

  test('editable and plain renders show the same text', () => {
    const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const l = sampleLetter();
    assert.equal(strip(renderLetter(l, { editable: true })), strip(renderLetter(l)));
  });
});

describe('renderResume', () => {
  test('every template renders an A4 page with the main sections', () => {
    assert.deepEqual(PAGE, { W: 794, H: 1123 });
    for (const t of TEMPLATES) {
      const html = renderResume(sampleResume(t.id));
      assert.ok(html.startsWith(`<div class="page tpl-${t.id}"`), t.id);
      for (const part of ['Jordan Rivera', 'Experience', 'Education', 'Skills', 'Brightline Analytics']) assert.ok(html.includes(part), `${t.id}: ${part}`);
    }
  });

  test('an empty CV still renders, with a name placeholder and no empty sections', () => {
    const r = blankResume();
    r.personal = Object.fromEntries(Object.keys(r.personal).map(k => [k, '']));
    const html = renderResume(r);
    assert.ok(html.includes('Your Name'));
    assert.equal(html.includes('r-sec'), false);
  });

  test('renderDoc picks the renderer by document type', () => {
    assert.ok(renderDoc(sampleLetter()).includes('Sincerely,'));
    assert.ok(renderDoc(sampleResume()).includes('Experience'));
  });
});
