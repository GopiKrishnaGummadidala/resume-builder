# Testing

Three layers, each catching what the one below cannot. All of them run in CI on every push and pull request.

| Layer | Tool | Count | Runs in | Time |
|---|---|---|---|---|
| Lint | ESLint 9 | whole repo | Node | ~3 s |
| Unit | Node's built-in test runner (`node --test`), no test libraries | 175 tests | Node, no browser | ~0.3 s |
| Browser (end-to-end) | Playwright, Chromium | 60 tests | Real browser against the served app | ~15 s |
| Container smoke | `curl` (site and API) + the same 60 browser tests against the Docker containers | | CI only | ~1 min |

## Running them

```bash
npm ci
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npx playwright install chromium
```

```bash
npm run test:e2e
```

To run the browser tests against the Docker container instead of the dev server:

```bash
BASE_URL=http://localhost:8090 npm run test:e2e
```

## Unit tests (`tests/unit/`)

The core modules have no browser dependencies, so they are tested as plain functions.

| File | What it proves |
|---|---|
| `store.test.js` | Stored data that is missing, corrupt or in the old format loads safely. Merge rules: newest copy wins, deletions are not undone, an edit after a deletion wins, old tombstones expire. Two simulated tabs never lose each other's documents. A write overwritten by a simultaneous save is healed and the tabs converge. Typing saves are delayed and can be flushed. A failing storage reports once and recovers. |
| `data.test.js` | `normalizeDoc` rejects non-documents, leaves clean documents untouched, replaces unknown templates/colours/fonts, forces every field to text, drops unknown fields, caps lengths and list sizes, survives junk list items. Defaults, date format, letter drafting, text export. |
| `templates.test.js` | Markup injected into **every field of every template** is escaped, for CVs and letters, editable or not. Letter markup (paragraphs, `# ` headings, `**bold**`). "To", greeting and closing always print. Editing attributes appear only in the live preview and never in print output; both renders show the same text. |
| `analysis.test.js` | Coach scores a strong CV high and an empty one low, flags weak openers and first-person wording. Bullet rewriting. ATS check on complete, empty and junk text. Keyword extraction and matched/partial/missing sorting, including empty input. |
| `project.test.js` | The two entry pages hold identical markup and assets. Every import resolves. **No circular imports; lower layers never import views.** Only `platform.js` talks to the CDN, and every library is version-pinned with an integrity hash. Core modules stay free of DOM access. The private profile file is git-ignored. File-name cleaning, safe path access, résumé text parsing. |

Three real defects were found by these tests while they were being written, all in input validation: a junk item in an imported list crashed validation; a missing id passed the id check because `undefined` was tested as the text "undefined"; and an object in a text field could throw during conversion. Each now has a test.

## Browser tests (`tests/e2e/app.spec.js`)

These drive the real app the way a person does: clicking, typing, pressing keys, downloading. Every test also fails if the page logs a script error.

| Area | What is exercised |
|---|---|
| Navigation | Every view opens; template filters; an unknown document id shows a message |
| CV editor | Typing updates the preview and survives a reload; adding a position; "Strengthen bullets"; switching template; markup typed into fields is displayed as text and never runs |
| Cover letter | "To", greeting and closing always present; editing the recipient **on the page** updates the greeting, the form and storage; a custom greeting is not overwritten; typing in the page body with Enter and Ctrl+B produces the right stored text; a formatted paste keeps bold and headings and drops foreign styling; drafting from a CV |
| PDF download | The file-name dialog, illegal characters and a typed `.pdf` are handled; the file downloads directly; **the print dialog never opens**; the file is a PDF **under the 200 KB budget**; the text can be read back out of the PDF; cancelling or an empty name downloads nothing |
| Documents | Duplicate; delete with confirm and cancel; a hostile JSON import yields a clean document with nothing executed; invalid JSON is rejected with a message |
| Two tabs | A document created in one tab appears in the other without reloading; neither tab loses the other's document; deleting a document that is open elsewhere is reflected there; an edit reloads the same document open in another tab |
| Tools | ATS checker scores a saved CV; the job matcher sorts keywords |

The size budget test is the regression guard for the PDF encoding: the previous encoder produced 607 KB for the same letter and would fail it.

## Continuous integration (`.github/workflows/ci.yml`)

Three jobs run in parallel on every push to `main` and every pull request:

1. **Lint and unit tests.**
2. **Browser tests** against the Node dev server. The Playwright HTML report is uploaded as an artifact, with traces for any failure.
3. **Docker image.** Builds the image and waits for its health check, then checks status codes and content types, that unknown paths return 404, that the security headers are present, that the container does not run as root, and that the private profile file is not in the image. Finally it runs the full browser suite against the container, which proves the Content-Security-Policy does not break PDF export or import.

A newer push cancels the run in progress for the same branch.

## Measurements, not tests

`scripts/load-test.mjs`, `scripts/bench.mjs` and `scripts/measure-pdf.mjs` produce the numbers in [load-test.md](load-test.md) and [design-rationale.md](design-rationale.md). They are run by hand; they do not gate the build.

## What is not covered

| Gap | Why | Risk |
|---|---|---|
| Firefox and Safari | CI runs Chromium only | In-page editing relies on `contenteditable`, where engines differ most. The form is the fallback |
| The hosted-artifact environment | It cannot be reproduced in CI (the host supplies the sandbox and the download permission) | `platform.js` is small and its hosted branch is a few lines; checked by hand after publishing |
| Visual comparison of the PDF | No pixel-diff test | A layout regression in the PDF would be caught only if it changes text or size. The page is rendered by the same function as the preview |
| PDF *import* of real-world files | Only the round trip of the app's own PDFs is tested | Parsing other people's PDFs is heuristic by design and labelled as such |
| Real clipboard contents from Word or Google Docs | Tests use representative HTML for both | The converters are defensive, but new editor versions can change their clipboard HTML |
| Accessibility | No automated audit | Controls are labelled and keyboard-reachable; not verified with a screen reader |
| Mobile layouts | Tests use a desktop viewport | The CSS is responsive; phone widths are checked by hand |
