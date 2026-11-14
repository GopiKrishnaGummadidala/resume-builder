# Design rationale

The main decisions, what was considered, and why the current choice was made. Numbers are measured; the scripts that produce them are named.

## 1. No backend

**Decision:** a static site. Documents live in the visitor's browser.

| Option | Why not / why |
|---|---|
| Server + database + accounts | Brings authentication, GDPR duties for CVs (names, phone numbers, employment history), hosting cost and an attack surface, for a tool one person uses on one machine |
| **Static files + localStorage** (chosen) | Nothing to breach, nothing to pay for, works behind any file server, trivially scalable |

**Cost:** no sync between devices, and clearing site data deletes the documents. "Export JSON" is the backup path. If sync is ever needed, `store.js` is the only module that changes: its backend is already an interface (`read`/`write`).

## 2. No framework, no build step

**Decision:** plain ES modules loaded directly by the browser.

The interface is a form, a rendered page and a few lists. A full re-render of a typical CV takes 0.02 ms (see [load-test.md](load-test.md)), so a virtual DOM would solve a problem that does not exist here. Without a bundler there is nothing between the source and what runs: what is in `js/` is what the browser executes, and the hosted-artifact version needs no separate build.

**Cost:** 13 small requests instead of one bundle (54 KB gzipped in total), and views are built from template strings, so discipline is needed about escaping. That discipline is enforced: every value passes through `esc()`, and tests inject markup into every field.

## 3. Documents render to an HTML string for a fixed A4 page

**Decision:** one pure function, `renderDoc(doc)`, returns the markup for a 794 × 1123 px page. Previews scale that page with a CSS transform.

This gives one source of truth for the editor preview, the thumbnails and the PDF. A document is designed once, at real size, and it can be unit-tested in Node as a string.

## 4. PDF export: indexed PNG plus an invisible text layer

This is the decision with the most alternatives.

**Requirements:** look exactly like the preview (including the Hind typeface), download directly with a chosen file name (no print dialog), work inside a sandboxed host where `window.print()` is blocked, keep text selectable for applicant tracking systems, and be small.

| Option | Looks like preview | Selectable text | Size (full one-page letter) | Verdict |
|---|---|---|---|---|
| Browser print → "Save as PDF" | yes | yes (real text) | smallest (vector text with subset fonts; typically tens of KB, not measured here) | Rejected: opens the print dialog, cannot set the file name, blocked in sandboxed hosts |
| jsPDF drawing real text | only if the font is embedded | yes | not measured; jsPDF embeds whole font files without subsetting, and Hind needs regular and bold | Rejected: the layout would have to be re-implemented in drawing calls and kept in step with the CSS, so there would be two layout engines to maintain |
| Bitmap as JPEG, quality 0.95 (first version) | yes | no | **607 KB** | Replaced |
| Bitmap as JPEG, quality 0.82 | visible ringing around letters | no | 420 KB | Rejected |
| **Bitmap as indexed PNG (48 colours) + invisible text** (chosen) | yes | yes | **162 KB** | Chosen |

Why indexed PNG wins: a page of text is a few flat colours with hard edges. JPEG is built for photographs and spends most of its bytes on those edges (and still blurs them). A palette image with lossless compression stores flat areas in almost nothing and keeps edges exact.

Measured with `node scripts/measure-pdf.mjs` (headless Chromium, the letter in `tests/fixtures.js`):

| Setting | Size | Build time |
|---|---|---|
| JPEG q0.95, 2× (old default) | 607 KB | 172 ms |
| JPEG q0.82, 2× | 420 KB | 154 ms |
| JPEG q0.82, 1.5× | 288 KB | 128 ms |
| Indexed PNG, 256 colours, 2× | 181 KB | 373 ms |
| **Indexed PNG, 48 colours, 2× (default)** | **162 KB** | **385 ms** |
| Indexed PNG, 16 colours, 2× | 129 KB | 339 ms |
| Indexed PNG, 48 colours, 1.5× | 114 KB | 302 ms |

- **48 colours, not 16:** at 16 the soft divider line shows banding and picks up a colour tint; at 48 the page is visually identical to the original. The 33 KB saved was not worth a visible defect.
- **2×, not 1.5×:** 2× is 192 dpi, which prints cleanly. 1.5× (144 dpi) saves 48 KB but text is visibly softer on paper.
- **Build time doubles** (about 0.2 s more) because the palette is computed in JavaScript. That is a good trade for a file a quarter of the size.

The settings are one object (`PDF_DEFAULTS`), and a browser test fails the build if a one-page letter exceeds 200 KB.

**The text layer.** After the image is placed, the code walks the page's text nodes, measures every word's position with a DOM `Range`, and writes the word into the PDF as invisible text at that position, stretched to the same width. Copy, search and text extraction work; a test reads the text back out of a generated PDF.

**Cost:** the text is not vector, so extreme zoom shows pixels, and the file is larger than a print-generated PDF with real text would be. Non-Latin-1 characters in the hidden layer are mapped (curly quotes, dashes, bullets) or dropped; the visible page is unaffected.

## 5. Letter body as plain text with light markup

**Decision:** the body is a string. Blank line = paragraph, `# ` = bold sub-heading, `**x**` = bold.

Storing HTML would mean sanitising it on every load and trusting it on every render. Plain text cannot carry a script, diffs cleanly, exports as readable JSON, and can be edited in a plain text box. The in-page editor and paste handling convert *to* this form (`richtext.js`); rendering converts *from* it with escaping (`letterBlocks`).

**Cost:** only bold and sub-headings are supported. That matches what a cover letter needs.

## 6. Editing on the page with `contenteditable`

**Decision:** the page is the primary editor for CVs and letters: all running text is typed on it, and entries are added, moved and removed there. The form stays as the complete editor in a side panel, closed by default.

The first version had the form as the main editor, with the page as a preview. People edit a CV by looking at it, so the roles were swapped. Both write to the same in-memory document through the same paths, so neither is a second implementation.

A full rich-text library (ProseMirror, Quill) would be the largest dependency in the project for two formatting features. The approach here is small: let the browser edit, read the DOM back into the stored markup, and never re-render the page while it has focus. Pastes are intercepted so foreign fonts and colours never enter the document.

**Cost:** browser editing behaviour differs slightly between engines. Because the form is always one click away, a quirk on the page cannot block anyone. Content that is displayed differently from how it is stored (skill chips, contact icons) is not typed on the page; a pencil opens its form field.

## 7. Storage: one entry, merged per document

**Decision:** one `localStorage` key; read–merge–write with last-write-wins per document and tombstones for deletions ([concurrency.md](concurrency.md)).

| Option | Verdict |
|---|---|
| Whole-state overwrite (first version) | Lost documents with two tabs open |
| One key per document | Fewer conflicts, but listing needs an index key, which brings the same merge problem back |
| IndexedDB | Transactions and more space, but an asynchronous API for a library of a few kilobytes per document; saves on page close become unreliable |
| CRDT / field-level merge | Correct for simultaneous multi-user editing, which this app does not have |
| **Read–merge–write, per-document LWW** (chosen) | Smallest design that removes the data-loss cases; pure functions, fully unit-tested |

500 documents are about 1.3 MB, a quarter of the usual 5 MB quota, and parse in 4 ms.

## 8. Third-party code: on demand, pinned, integrity-checked

**Decision:** nothing third-party is needed to open the app. PDF export (html2canvas, jsPDF, pako, UPNG) and PDF import (pdf.js) load from cdnjs the first time they are used.

Each file is pinned to an exact version and carries a Subresource Integrity hash, so a compromised or changed CDN file is refused by the browser. All of it goes through one function (`loadLib`), which a unit test enforces. Vendoring the files into the repository was considered: it removes the CDN dependency but adds about 2 MB of minified code to review and keep updated, and the hosted-artifact environment allows only a short list of script hosts anyway.

**Cost:** export and import need network access on first use.

## 9. Rule-based coaching instead of a language model

**Decision:** the coach, ATS check, keyword matcher, bullet "strengthen" and letter draft are deterministic functions.

They run instantly, offline, cost nothing, never invent qualifications, and can be unit-tested with exact expectations. A language model would write better prose, but needs an API key, a server to keep it secret, and sends CV contents off the device, which contradicts decision 1. The seams are obvious if that changes: `draftLetterBody()` and `strengthenBullet()`.

## 10. Personal defaults outside git

**Decision:** default name, phone, email and links come from `js/profile.local.js`, which is git-ignored and loaded with a guarded dynamic import.

The app is useful pre-filled, but a phone number does not belong in a repository. A missing file simply means empty defaults. **Cost:** an image built on a machine that has the file contains it (documented in the Dockerfile); CI images never do, and a CI step checks that.

## 11. Templates as data, layout settings as CSS variables

**Decision:** a template is a row in a table: a layout, a header style, a skills style and a CSS class. Spacing, margins and page size are three values on the document that become CSS variables on the page.

The first seven templates were told apart by checks on the template id inside the renderer. Adding six more that way would have doubled the branches. With the table, a new template that reuses an existing layout is one row and some CSS, and the renderer has four layout paths however many templates there are.

Spacing and margins are steps (1 to 7 and 1 to 6), not free numbers. A step is validated as an integer in range and mapped to a multiplier in code, so nothing a file contains can reach a `style` attribute. Each template keeps its own proportions, because the multiplier scales the template's own values.

**Cost:** a template with a truly new structure still needs a new layout path in `templates.js`.

## 12. Certifications and languages stay as text, with optional parts

**Decision:** a certification or a language is one line: `Name | detail | date`. The detail and date are optional. Achievements, which need a paragraph each, are a list of items like experience.

| Option | Verdict |
|---|---|
| Turn both into lists of objects | Needs a migration for every saved CV and every exported file, and a larger form for what is usually one short line |
| **One line with optional parts** (chosen) | Every existing CV keeps working unchanged (a line without `|` is just a name); the form stays a small text box; templates that have room show the parts separately |

Language level dots are computed from the wording of the detail when the page is drawn. Storing a number as well would let the two disagree.

**Cost:** `|` cannot be used inside a name, and a level only gets dots if it uses a common word (Native, Fluent, Professional, Intermediate, Elementary, or A1 to C2).

## 13. Photo stored in the document, shrunk on upload

**Decision:** an uploaded image is cropped to a centred square, drawn to a 320 px canvas and saved as a JPEG data URL inside the document.

| Option | Verdict |
|---|---|
| Store the original file | A phone photo is several megabytes; two would fill the 5 MB localStorage quota |
| IndexedDB for images | Adds an asynchronous second store, and a document would no longer be one self-contained JSON object (export, import and cross-tab merge all rely on that) |
| **320 px JPEG in the document** (chosen) | About 30 KB; export, import, duplicate and merge keep working unchanged; re-encoding removes metadata such as GPS position |

320 px is 2.7 times the largest size a photo is drawn at (120 px), which is enough for the 2× page capture.

**Cost:** no manual crop; the centre square is used.

## 14. PDF import reads the layout, not just the text

**Decision:** import works from the positions pdf.js reports for each run of text, and rebuilds reading order before any parsing.

The first version joined the runs in the order pdf.js returned them. That is drawing order: on a two-column CV every line of the side column was interleaved with the main column ("Software Engineer" next to "Angular React Next.js"), so sections, jobs and skills came out mixed. Detecting the gutter from the positions, then reading each column on its own, fixes this without guessing from words. Bold comes from the font name, which keeps highlighted phrases in bullets and lets bold job titles and certificate names mark where an entry starts.

| Option | Verdict |
|---|---|
| Text in pdf.js order (first version) | Interleaves columns; unusable for two-column CVs |
| An AI or cloud parsing service | Better on odd layouts, but sends the CV off the device (decision 1) |
| **Layout reconstruction, then rules** (chosen) | Local, deterministic, unit-testable with made-up layouts; handles this app's 14 templates and common one- and two-column CVs |

**Cost:** rules have limits: tables, three columns or text drawn as images are not read correctly. The import says so, and every field stays editable.

## 15. Page breaks by moving blocks, measured on the real page

**Decision:** before a PDF is captured (and on every preview redraw), `paginate()` walks the page's blocks top to bottom: section headings with their first line, entry headers with their first bullet, bullets, paragraphs, letter paragraphs and side cards. A block that would cross a page edge, or sit in the top or bottom margin of a later page, gets a larger top margin so it starts on the next page.

| Option | Verdict |
|---|---|
| Cut the bitmap at fixed heights (first version) | Splits lines of text across pages |
| CSS `break-inside: avoid` | Only applies when the browser prints or paginates; the PDF here is captured from one tall page |
| Lay out every page separately | Would need the templates to be split into page-sized pieces; two-column templates make that very hard |
| **Measure, then move blocks down** (chosen) | Uses the browser's real layout; works for every template and both columns independently; the same code drives the preview, so it shows the PDF's pages |

**Cost:** the spacing is added as inline margins on the rendered page; while a block is being typed in, its spacing is removed (so Enter does not copy it) and restored when typing ends.

## 16. A photo is its own image in the PDF

**Decision:** the photo is cut out of the page bitmap and stored as a small JPEG laid over the page image; the area under it is filled with one colour before the page is encoded.

A photo needs the full 256-colour palette (with fewer, skin tones show bands), which made every page with a photo about 20% larger. Stored separately, the photo costs about 15 KB and the page keeps its 48-colour palette. Measured on a dense two-page CV with a photo: 584 KB before, 490 KB after.

**Cost:** none visible. The remaining size of a dense multi-page CV comes from the sharp edges of a lot of text in a bitmap (see decision 4); real vector text would be the fix.

## 17. Container hardening

nginx runs from the unprivileged image as uid 101 on a read-only filesystem with all capabilities dropped. The server only reads files, so it is given the ability to do nothing else. A Content-Security-Policy limits scripts to the site itself and cdnjs. The browser tests run against the container in CI specifically to prove the policy does not break PDF export or import.
