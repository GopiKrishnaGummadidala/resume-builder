// Benchmarks for the in-browser logic, run in Node (the code is the same; a browser JIT is comparable).
// Usage: node scripts/bench.mjs        Numbers in docs/load-test.md come from this script.
import { performance } from 'node:perf_hooks';
import { sampleResume, sampleLetter, resumeToText, normalizeDoc, uid } from '../js/data.js';
import { renderResume, renderLetter } from '../js/templates.js';
import { coachResume, atsCheck, matchJob } from '../js/analysis.js';
import { parseState, mergeStates } from '../js/store.js';
import { FULL_LETTER_BODY } from '../tests/fixtures.js';

function time(label, fn, runs = 200) {
  for (let i = 0; i < 20; i++) fn(); // warm up
  const samples = [];
  for (let i = 0; i < runs; i++) { const t0 = performance.now(); fn(); samples.push(performance.now() - t0); }
  samples.sort((a, b) => a - b);
  return { operation: label, 'median (ms)': samples[Math.floor(runs / 2)].toFixed(3), 'p95 (ms)': samples[Math.floor(runs * 0.95)].toFixed(3) };
}

const cv = sampleResume();
const bigCv = sampleResume();
bigCv.experience = Array.from({ length: 50 }, (_, i) => ({ ...cv.experience[0], id: uid(), role: `Role ${i}` })); // the maximum the model allows
const letter = { ...sampleLetter(), body: FULL_LETTER_BODY };
const text = resumeToText(bigCv);
const jd = 'Senior Product Designer with Figma, design systems, user research, accessibility, SQL and Python. '.repeat(20);

const library = n => ({ schema: 2, deleted: {}, docs: Array.from({ length: n }, (_, i) => ({ ...(i % 2 ? letter : cv), id: uid(), updatedAt: i })) });
const lib500 = library(500);
const lib500json = JSON.stringify(lib500);
const other500 = { ...lib500, docs: lib500.docs.map(d => ({ ...d, updatedAt: d.updatedAt + 1 })) };

console.table([
  time('render a typical CV', () => renderResume(cv)),
  time('render a CV with 50 positions (model maximum)', () => renderResume(bigCv)),
  time('render a full-page cover letter', () => renderLetter(letter)),
  time('render a cover letter, editable preview', () => renderLetter(letter, { editable: true })),
  time('coach a typical CV', () => coachResume(cv)),
  time('coach a CV with 50 positions', () => coachResume(bigCv)),
  time('ATS check on a 50-position CV text', () => atsCheck(text)),
  time('job match, long ad vs 50-position CV', () => matchJob(text, jd), 100),
  time('validate one document', () => normalizeDoc(cv)),
  time('serialise 500 documents', () => JSON.stringify(lib500), 50),
  time('parse + validate 500 documents', () => parseState(lib500json), 50),
  time('merge two 500-document libraries', () => mergeStates(lib500, other500), 50),
]);
console.log(`One typical CV is ${(JSON.stringify(cv).length / 1024).toFixed(1)} KB as JSON; a full-page letter is ${(JSON.stringify(letter).length / 1024).toFixed(1)} KB.`);
console.log(`500 documents are ${(lib500json.length / 1024).toFixed(0)} KB (localStorage allows about 5,000 KB per site).`);
