import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderResume, renderLetter, renderDoc, letterBlocks, contactUrl, esc, TEMPLATES, PAGE } from '../../js/templates.js';
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

describe('contact links', () => {
  test('contactUrl builds profile, site and mail addresses', () => {
    assert.equal(contactUrl('linkedin', 'linkedin.com/in/jordan-rivera'), 'https://linkedin.com/in/jordan-rivera');
    assert.equal(contactUrl('linkedin', 'https://www.linkedin.com/in/jordan-rivera/'), 'https://www.linkedin.com/in/jordan-rivera/');
    assert.equal(contactUrl('linkedin', 'jordan-rivera'), 'https://www.linkedin.com/in/jordan-rivera');
    assert.equal(contactUrl('github', 'jordanr'), 'https://github.com/jordanr');
    assert.equal(contactUrl('github', 'github.com/jordanr'), 'https://github.com/jordanr');
    assert.equal(contactUrl('website', 'jordan.example'), 'https://jordan.example');
    assert.equal(contactUrl('email', 'jordan@example.com'), 'mailto:jordan@example.com');
  });

  test('contactUrl refuses anything that is not a web or mail address', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'vbscript:x', 'my profile', '', null, XSS]) {
      for (const kind of ['linkedin', 'github', 'website', 'email']) assert.equal(contactUrl(kind, bad), '', `${kind}: ${bad}`);
    }
    assert.equal(contactUrl('phone', '+49 40 1234'), '');
    assert.equal(contactUrl('location', 'hamburg.de'), '');
    assert.equal(contactUrl('website', 'bare-word'), '');
    assert.equal(contactUrl('email', 'javascript:x@y.z'), '');
  });

  test('LinkedIn and GitHub are links that open in a new tab, in every template', () => {
    for (const t of TEMPLATES) {
      for (const doc of [sampleResume(t.id), { ...sampleLetter(), templateId: t.id }]) {
        doc.personal.linkedin = 'linkedin.com/in/jordan-rivera';
        doc.personal.github = 'github.com/jordanr';
        const html = renderDoc(doc);
        for (const url of ['https://linkedin.com/in/jordan-rivera', 'https://github.com/jordanr']) {
          const tag = html.match(new RegExp(`<a[^>]*href="${url}"[^>]*>`));
          assert.ok(tag, `${t.id} ${doc.type}: ${url} is not a link`);
          assert.match(tag[0], /target="_blank"/);
          assert.match(tag[0], /rel="noopener noreferrer"/);
        }
      }
    }
  });

  test('a script address in a contact field never becomes a link', () => {
    for (const t of TEMPLATES) {
      const r = sampleResume(t.id);
      r.personal.linkedin = r.personal.github = r.personal.website = r.personal.email = 'javascript:alert(1)';
      const html = renderResume(r);
      assert.equal(/href="\s*javascript:/i.test(html), false, t.id);
      assert.ok(html.includes('javascript:alert(1)'), 'still shown as text');
    }
  });
});

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const pageStyle = html => html.match(/<div class="page [^"]*" style="([^"]*)"/)[1];

describe('templates list', () => {
  test('every template has a known layout, header and skills style', () => {
    assert.equal(TEMPLATES.length, 14);
    assert.equal(new Set(TEMPLATES.map(t => t.id)).size, TEMPLATES.length);
    for (const t of TEMPLATES) {
      assert.ok(['single', 'side-left', 'side-right', 'profile'].includes(t.layout), t.id);
      assert.ok(['plain', 'split', 'sidebar', 'banner'].includes(t.header), t.id);
      assert.ok(['inline', 'chips', 'list'].includes(t.skills), t.id);
      assert.ok(t.name && t.desc && t.tags.length, t.id);
    }
  });

  test('every template shows every part of a full CV exactly once', () => {
    for (const t of TEMPLATES) {
      const html = renderResume(sampleResume(t.id));
      for (const text of ['Jordan Rivera', 'Brightline Analytics', 'B.A. Interaction Design', 'Figma', 'Open-source icon set', 'Nielsen Norman UX Certification', 'Spanish', 'Analytics platform for mid-size retailers', 'Design system adoption', 'Letterpress printing']) {
        assert.equal(html.split(text).length - 1, 1, `${t.id}: "${text}"`);
      }
      assert.ok(html.includes('Product designer with 7 years'), `${t.id}: summary`);
    }
  });

  test('an unknown template id renders with the default template instead of failing', () => {
    const html = renderResume({ ...sampleResume(), templateId: 'nope' });
    assert.ok(html.includes('Jordan Rivera'));
    assert.ok(renderLetter({ ...sampleLetter(), templateId: 'nope' }).includes('Sincerely,'));
  });
});

describe('page settings on the page', () => {
  test('page size, spacing and margins are set as style variables', () => {
    const a4 = pageStyle(renderResume(sampleResume()));
    assert.match(a4, /--pw:794px;--ph:1123px;--sp:1;--mg:1/);
    const doc = sampleResume();
    doc.theme = { ...doc.theme, size: 'letter', spacing: 1, margin: 6 };
    assert.match(pageStyle(renderResume(doc)), /--pw:816px;--ph:1056px;--sp:0\.6;--mg:1\.4/);
    assert.match(pageStyle(renderLetter({ ...sampleLetter(), theme: doc.theme })), /--pw:816px;--ph:1056px/);
  });

  test('hostile settings cannot add styles to the page', () => {
    const doc = sampleResume();
    doc.theme = { ...doc.theme, size: 'a4;background:url(//evil)', spacing: '1;color:red', margin: { toString: () => 'x' } };
    assert.match(pageStyle(renderResume(doc)), /--pw:794px;--ph:1123px;--sp:1;--mg:1$/);
  });
});

describe('photo on the page', () => {
  test('a photo is drawn once in every template, for CVs and letters', () => {
    for (const t of TEMPLATES) {
      for (const doc of [sampleResume(t.id), { ...sampleLetter(), templateId: t.id }]) {
        doc.personal = { ...doc.personal, photo: PHOTO };
        const html = renderDoc(doc);
        assert.equal(html.split('<img class="r-photo"').length - 1, 1, `${t.id} ${doc.type}`);
        assert.ok(html.includes(`src="${PHOTO}"`), `${t.id} ${doc.type}`);
      }
    }
  });

  test('no photo, no image; and only embedded images are ever drawn', () => {
    assert.equal(renderResume(sampleResume()).includes('<img'), false);
    for (const photo of ['https://example.com/track.gif', 'javascript:alert(1)', 'data:image/svg+xml;base64,AAAA', 'x" onerror="alert(1)']) {
      for (const t of TEMPLATES) {
        const doc = sampleResume(t.id);
        doc.personal.photo = photo;
        assert.equal(renderResume(doc).includes('<img'), false, `${t.id}: ${photo}`);
      }
    }
  });
});

describe('richer CV content', () => {
  test('bullets and achievements allow **bold** and nothing else', () => {
    const r = sampleResume();
    r.experience[0].bullets = 'Grew revenue **by 40%** <b>x</b>';
    r.achievements[0].description = 'Saved **3 days** a week <i>y</i>';
    const html = renderResume(r);
    assert.ok(html.includes('Grew revenue <strong>by 40%</strong> &lt;b&gt;x&lt;/b&gt;'));
    assert.ok(html.includes('Saved <strong>3 days</strong> a week &lt;i&gt;y&lt;/i&gt;'));
  });

  test('no new field can inject markup, in any template', () => {
    for (const t of TEMPLATES) {
      const r = sampleResume(t.id);
      r.interests = XSS;
      r.certifications = r.languages = `${XSS} | ${XSS} | ${XSS}`;
      r.experience[0].about = XSS;
      r.achievements = [{ id: 'aaaa1111', title: XSS, date: XSS, description: XSS }];
      const html = renderResume(r);
      assert.equal(html.includes('<img'), false, t.id);
      assert.equal(/onerror=alert\(1\)>/.test(html), false, t.id);
    }
  });

  test('entries written the old way, separated by commas, still show', () => {
    for (const t of TEMPLATES) {
      const r = sampleResume(t.id);
      r.certifications = 'Scrum Master (2021), AWS Practitioner';
      r.languages = 'English (native), Spanish';
      const html = renderResume(r);
      for (const text of ['Scrum Master (2021)', 'AWS Practitioner', 'English (native)', 'Spanish']) assert.ok(html.includes(text), `${t.id}: ${text}`);
    }
  });

  test('empty achievements and interests draw no section', () => {
    for (const t of TEMPLATES) {
      const r = sampleResume(t.id);
      r.achievements = [{ id: 'aaaa1111', title: '', date: '2020', description: '' }];
      r.interests = ' , ';
      const html = renderResume(r);
      assert.equal(html.includes('data-sec="achievements"'), false, t.id);
      assert.equal(html.includes('data-sec="interests"'), false, t.id);
    }
  });

  test('Signature puts education, certificates and language levels in the right column', () => {
    const html = renderResume(sampleResume('signature'));
    const side = html.slice(html.indexOf('<aside class="r-side">'));
    for (const sec of ['skills', 'certifications', 'languages', 'education', 'achievements', 'interests']) assert.ok(side.includes(`data-sec="${sec}"`), sec);
    assert.equal(side.includes('data-sec="experience"'), false);
    assert.ok(side.includes('<span class="r-e-t">Nielsen Norman UX Certification</span><span class="r-e-s">NN/g</span><span class="r-e-d">2022</span>'));
    assert.ok(side.includes('aria-label="Level 5 of 5"'), 'English | Native');
    assert.ok(side.includes('aria-label="Level 3 of 5"'), 'Spanish | Professional working');
    assert.equal((side.match(/class="on"/g) || []).length, 8);
    // Profile keeps education in the main column.
    const profile = renderResume(sampleResume('profile'));
    assert.ok(profile.indexOf('data-sec="education"') < profile.indexOf('<aside class="r-side">'));
  });
});
