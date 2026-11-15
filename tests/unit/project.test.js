// Checks on the project as a whole: the two entry pages, module wiring and pure helpers.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanFileName, setPath, getPath } from '../../js/ui.js';
import { latin1, pdfName, PDF_DEFAULTS } from '../../js/pdf-export.js';
import { parseResumeText } from '../../js/importer.js';
import { sampleResume, sampleLetter, blankLetter } from '../../js/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');

describe('entry pages', () => {
  test('index.html and artifact.html contain the same app markup', () => {
    const body = html => html.slice(html.indexOf('<header'), html.indexOf('<script type="module"')).replace(/^\s+/gm, '').trim();
    assert.equal(body(read('artifact.html')), body(read('index.html')));
  });

  test('both pages load the same styles, fonts and entry module', () => {
    const assets = html => [...html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)].map(m => m[1]).filter(u => !u.startsWith('https://fonts.g') || u.includes('css2')).sort();
    assert.deepEqual(assets(read('artifact.html')), assets(read('index.html')));
  });

  test('artifact.html has no document skeleton (the host adds it)', () => {
    assert.equal(/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(read('artifact.html')), false);
  });
});

describe('modules', () => {
  const files = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));

  test('every relative import points at a file that exists', () => {
    for (const f of files) {
      for (const [, spec] of read(`js/${f}`).matchAll(/from '(\.\/[^']+)'/g)) {
        assert.ok(fs.existsSync(path.join(root, 'js', spec)), `${f} imports missing ${spec}`);
      }
    }
  });

  test('modules form layers: no circular imports', () => {
    const graph = new Map(files.map(f => [f, [...read(`js/${f}`).matchAll(/from '\.\/([^']+)'/g)].map(m => m[1])]));
    const state = new Map(); // file -> 'visiting' | 'done'
    const visit = (f, trail) => {
      if (state.get(f) === 'done') return;
      assert.notEqual(state.get(f), 'visiting', `circular import: ${[...trail, f].join(' -> ')}`);
      state.set(f, 'visiting');
      for (const dep of graph.get(f) || []) visit(dep, [...trail, f]);
      state.set(f, 'done');
    };
    for (const f of files) visit(f, []);
  });

  test('lower layers never import the views', () => {
    const views = ['app.js', 'editor.js', 'tools.js', 'preview.js', 'tailorpage.js'];
    for (const f of files.filter(f => !views.includes(f))) {
      for (const [, dep] of read(`js/${f}`).matchAll(/from '\.\/([^']+)'/g)) {
        assert.equal(views.includes(dep), false, `${f} must not import the view module ${dep}`);
      }
    }
  });

  test('only platform.js talks to the CDN, and every library is pinned with an integrity hash', () => {
    for (const f of files) {
      if (f !== 'platform.js') assert.equal(read(`js/${f}`).includes('cdnjs.cloudflare.com'), false, `${f} loads from the CDN directly`);
    }
    const libs = [...read('js/platform.js').matchAll(/path: '([^']+)', integrity: '([^']+)'/g)];
    assert.ok(libs.length >= 6);
    for (const [, p, integrity] of libs) {
      assert.match(p, /\/\d+\.\d+\.\d+\//, `${p} is not pinned to an exact version`);
      assert.match(integrity, /^sha384-[A-Za-z0-9+/]{64}$/, p);
    }
  });

  test('the model and storage layers do not touch the DOM', () => {
    for (const f of ['data.js', 'analysis.js', 'templates.js']) {
      const code = read(`js/${f}`).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // ignore comments
      assert.equal(/\bdocument\.|\bwindow\.|localStorage/.test(code), false, `${f} must stay DOM-free`);
    }
  });

  test('the private profile file is ignored by git', () => {
    assert.match(read('.gitignore'), /^js\/profile\.local\.js$/m);
  });
});

describe('helpers', () => {
  test('cleanFileName removes illegal characters and a typed extension', () => {
    assert.equal(cleanFileName('Cover Letter - Colenet.pdf', 'pdf'), 'Cover Letter - Colenet');
    assert.equal(cleanFileName('a/b\\c:d*e?f"g<h>i|j', 'pdf'), 'a b c d e f g h i j');
    assert.equal(cleanFileName('   ', 'pdf'), '');
    assert.equal(cleanFileName('report.PDF', 'pdf'), 'report');
    assert.equal(cleanFileName('x'.repeat(500), 'pdf').length, 120);
  });

  test('setPath and getPath work on nested paths and refuse prototype keys', () => {
    const o = { personal: { name: 'a' }, experience: [{ role: 'x' }] };
    setPath(o, 'personal.name', 'b');
    setPath(o, 'experience.0.role', 'y');
    assert.equal(getPath(o, 'personal.name'), 'b');
    assert.equal(getPath(o, 'experience.0.role'), 'y');
    assert.equal(getPath(o, 'missing.deep'), undefined);
    assert.throws(() => setPath(o, '__proto__.polluted', 1), /Unsafe path/);
    assert.throws(() => setPath(o, 'constructor.prototype.x', 1), /Unsafe path/);
    assert.equal({}.polluted, undefined);
  });

  test('latin1 maps typographic characters for the PDF text layer', () => {
    assert.equal(latin1('“I’d” – yes… • ok'), '"I\'d" - yes... - ok');
    assert.equal(latin1('naïve café €5 ✓'), 'naïve café 5 ');
  });

  test('pdfName suggests a readable file name', () => {
    assert.equal(pdfName(sampleLetter()), 'Sample Cover letter for Acme'); // a letter uses its own name
    const unnamed = blankLetter();
    unnamed.personal.name = 'Jordan Rivera';
    assert.equal(pdfName(unnamed), 'Jordan Rivera Cover Letter'); // no recipient yet
    assert.equal(pdfName({ ...unnamed, title: 'Cover Letter - Northwind Labs' }), 'Cover Letter - Northwind Labs');
    assert.equal(pdfName(sampleResume()), 'Jordan Rivera CV');
    assert.equal(pdfName({ type: 'cover', title: 'My: letter?', personal: { name: '' } }), 'My letter');
    assert.equal(pdfName({ type: 'cover', title: '???', personal: {} }), 'document');
  });

  test('PDF defaults use the compact indexed encoder', () => {
    assert.equal(PDF_DEFAULTS.encoder, 'indexed');
    assert.ok(PDF_DEFAULTS.colors <= 256);
  });
});

describe('parseResumeText', () => {
  const TEXT = `Jane Doe
Senior Engineer
jane.doe@example.com | +49 151 23456789 | linkedin.com/in/janedoe

Summary
Engineer with ten years of experience.

Experience
Senior Engineer
Acme GmbH 2019 - Present
• Built a billing system used by 120 clients
• Cut build time by 40%

Education
B.Sc. Computer Science
TU Hamburg 2012 - 2015

Skills
TypeScript, C#, Docker`;

  test('pulls out contact details, sections and bullets', () => {
    const r = parseResumeText(TEXT);
    assert.equal(r.personal.name, 'Jane Doe');
    assert.equal(r.personal.title, 'Senior Engineer');
    assert.equal(r.personal.email, 'jane.doe@example.com');
    assert.equal(r.personal.linkedin, 'linkedin.com/in/janedoe');
    assert.match(r.summary, /ten years/);
    assert.equal(r.experience.length, 1);
    assert.equal(r.experience[0].role, 'Senior Engineer');
    assert.equal(r.experience[0].bullets.split('\n').length, 2);
    assert.equal(r.education[0].degree, 'B.Sc. Computer Science');
    assert.equal(r.skills, 'TypeScript, C#, Docker');
  });

  test('never throws on empty or unstructured text', () => {
    for (const t of ['', 'just one line', '\n\n\n', '• • •']) assert.equal(parseResumeText(t).type, 'resume');
  });
});
