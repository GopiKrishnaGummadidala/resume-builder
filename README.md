# Craftfolio — CV & Cover Letter Builder

[![CI](https://github.com/GopiKrishnaGummadidala/resume-builder/actions/workflows/ci.yml/badge.svg)](https://github.com/GopiKrishnaGummadidala/resume-builder/actions/workflows/ci.yml)

A CV and cover letter builder that runs in the browser. Without an account, documents stay in the visitor's own browser. With the optional API server (`server/`, PostgreSQL), people can create an account, sign in with email and password, and keep their documents on any device. Inspired by the feature set of online resume builders such as novoresume.com.

## Run with Docker Compose

```bash
cp .env.example .env      # then set POSTGRES_PASSWORD (letters and digits)
docker compose up -d --build
```

Then open http://localhost:8090. Three containers: **web** (nginx, non-root, read-only filesystem) serves the app and passes `/api/` to **api** (Node.js, accounts and documents), which stores them in **db** (PostgreSQL 16, volume `craftfolio-db`, not published on the host).

- Change the port: `CRAFTFOLIO_PORT=9000 docker compose up -d`
- Rebuild after editing files: `docker compose up -d --build`
- Stop: `docker compose down`

Guests' documents stay in their browser (localStorage). Signed-in users' documents are in PostgreSQL; the browser keeps a working copy so editing stays fast and works offline. Back up the database with `docker compose exec db pg_dump -U craftfolio craftfolio > backup.sql`.

## Run without Docker

```bash
npm run serve
```

Then open http://localhost:5180. Any static file server works (for example `python -m http.server 5180`). The app must be served over HTTP; browsers do not load ES modules from `file://`. Served this way there is no API, so the app runs without accounts.

With accounts, against your own PostgreSQL (the server creates its tables on start):

```bash
DATABASE_URL=postgres://craftfolio:secret@localhost:5432/craftfolio STATIC_DIR=. PORT=5181 node server/index.js
```

Then open http://localhost:5181 (the server also serves the app when `STATIC_DIR` is set).

## Tailor a CV and cover letter to a job (AI)

Open **Tailor** on a CV card (or **Tailor to job** in the editor), give the job ad, choose a template for the CV and one for the cover letter, and get a tailored **copy** of the CV plus a **one-page cover letter**, each with a Download PDF button.

- **The job ad:** paste its text, or (signed in) give its link and **Fetch**: the server reads the page, from its JobPosting data when the site publishes it. Pages behind a login or built only with JavaScript cannot be read; paste their text. The fetch refuses private and local addresses (checked when connecting, also after redirects), only uses the standard ports, and stops at 10 s or 3 MB.
- **One page:** the letter is written to 230–330 words; when a template's spacing still makes it spill over, spacing and then margins are tightened until it fits. Every cover letter download is fitted the same way.

In step 3 you choose the AI with a radio button, then press **Generate**:

- **Connected (one click):** **Claude** when the server has `ANTHROPIC_API_KEY` (Claude Opus 5.5, or `TAILOR_MODEL`), **ChatGPT** when it has `OPENAI_API_KEY` (`gpt-5.5`, or `OPENAI_MODEL`); set them in `.env` (see `.env.example`). Both use structured output, run for signed-in users only, 20 tailorings per user per hour; each one is billed to that key. Without a key the option is shown greyed out with the reason.
- **On the AI's website (free):** ChatGPT, Claude or Gemini. Generate copies the prompt and opens the site; paste the prompt there, then paste its answer back and it is checked at once. No key and no account needed.

The AI may only rewrite the headline and summary, reword and reorder each job's bullets, and reorder skills. Its answer is then checked against the CV (`js/tailor.js`): a change that uses a number the CV does not contain is left out, skills the CV does not mention are not added, no skill is removed, every job keeps its employer, title, dates and most of its bullets, and the cover letter may use only the CV's facts and numbers, with no placeholders. You review each change before the copy is made; the original CV is never changed. Only CV content is sent to the AI: no name, contact details or photo.

## Accounts

- **Sign-in:** email and password. Passwords are stored only as scrypt hashes; at least 10 characters.
- **Sessions:** a random token in an HttpOnly, SameSite=Lax cookie (Secure over HTTPS), valid 30 days; the database keeps only its SHA-256. Signing out ends the session and removes the account's working copy from that browser.
- **Forgery protection:** every request that changes data must carry `X-Craftfolio: 1` and come from the same origin.
- **Brute force:** sign-in attempts are limited per address and per account, sign-ups per address (in memory, per server process).
- **Sync:** edits are sent after a short pause; changes from other devices are fetched when the tab regains focus and every minute. The newer copy of a document wins, and a deletion wins over older edits, the same rules as between browser tabs (docs/concurrency.md).
- **Guests:** the app works without an account. On sign-up or sign-in, documents made in that browser are offered to move into the account.
- **Limits:** 500 documents per account, 1 MB per document.
- **API:** `server/app.js` lists the endpoints; the schema is in `server/migrations/`.

## Features

- **CV builder**: 14 templates. Single-column: Banner, Classic, Minimal, Executive, Tech, Timeline, Elegant, Bold, Corporate. Two-column: Profile, Signature, Modern, Studio, Compact. The page is the editor: click any text to change it, add, move and remove entries on the page, and open the complete form or the coach from the tool rail when you want them.
- **CV sections**: summary, experience (with an optional line about each company and **bold** in bullets), education, skills, projects, certifications and languages (each with an optional detail and date, written `Name | detail | date`), achievements and interests.
- **Layout, Fonts, Themes**: content spacing, page margins and page size (A4 or US Letter); 8 fonts; 8 colours or any custom colour.
- **Photo**: optional profile photo, cropped to a square and shrunk in the browser before it is stored.
- **Undo / redo** for every change in the editor.
- **Cover letter builder**: the same templates, so a CV and its letter match. Edit the letter directly on the page (recipient, date, greeting, body, closing) or in the form. Bold and sub-headings; pasting from Word or Google Docs keeps bold. "Draft from a CV" writes a first draft.
- **Live coach**: a score with concrete tips (action verbs, numbers, bullet counts, length, consistency).
- **Strengthen bullets**: rewrites weak openers ("Responsible for…" → "Managed…").
- **ATS checker**: upload a PDF/TXT, paste text or pick a saved CV.
- **Job matcher**: matched, close and missing keywords against a job advert.
- **Import**: PDF, TXT, or a JSON export. Two-column PDFs are read column by column, and contact details, jobs (with dates, place and company note), bullets with bold, education, skills, certificates, languages, achievements and interests are filled in, and a profile photo placed in the PDF is imported too. A PDF downloaded from this app imports back into the same fields. Parsing is still best-effort: review the result.
- **Page breaks**: a CV or letter longer than a page is split between entries, bullets and paragraphs, never through a line; later pages get a top margin, and a section that continues on a new page repeats its heading. Signature also prints "Page 1 of 2". The preview shows dashed lines where each PDF page ends.
- **Download PDF**: asks for a file name and downloads directly. Documents in Hind (the default font) get real text in the embedded font: sharp at any zoom, read by applicant tracking systems in reading order with "•" bullets, and small (a dense two-page CV with a photo is about 130 KB). Other fonts fall back to a picture of the page with an invisible text layer. Email, website, LinkedIn and GitHub links are clickable.
- **Letter names**: a cover letter is named "Cover Letter - <company>" from its "To" details, until you type a name yourself. The download uses the same name.
- **Storage**: everything stays in `localStorage`, merged safely across open tabs; "Export JSON" for backups.

## Your default details

New CVs and cover letters start with the name, headline, email, phone, location and links from `js/profile.local.js`. Every field stays editable per document, and **↺ Reset to my details** in the Personal details section restores them.

The file is git-ignored so contact details stay out of the repository. To set it up, copy `js/profile.example.js` to `js/profile.local.js` and fill it in. Without it, new documents start empty. A Docker image built on a machine that has the file includes it, so rebuild after editing: `docker compose up -d --build`.

## Development

```bash
npm ci
```

| Command | What it does |
|---|---|
| `npm run lint` | ESLint over the app, tests and scripts |
| `npm test` | 145 unit tests (Node's built-in runner, no browser) |
| `npm run test:e2e` | 52 browser tests (Playwright; run `npx playwright install chromium` once). If your machine blocks Playwright's own browser, set `PW_CHANNEL=msedge` or `PW_CHANNEL=chrome` to use an installed one. |
| `npm run serve` | Static dev server on port 5180 |
| `npm run load` | HTTP load test against the running container |
| `node scripts/bench.mjs` | Timings for rendering, coaching, storage |
| `node scripts/measure-pdf.mjs` | PDF size and build time per encoder setting |

CI (GitHub Actions) runs lint, unit tests, the browser tests, and a Docker build with smoke checks and the browser tests against the container.

## Documentation

| Document | Contents |
|---|---|
| [docs/architecture.md](docs/architecture.md) | System context, module layers, security model, known weaknesses |
| [docs/data-flow.md](docs/data-flow.md) | Start-up, editing, saving, cross-tab sync, import, PDF export |
| [docs/concurrency.md](docs/concurrency.md) | Multiple tabs, merge rules, async work, what is and is not guaranteed |
| [docs/design-rationale.md](docs/design-rationale.md) | Decisions, alternatives and measurements (including the PDF encoding) |
| [docs/assumptions.md](docs/assumptions.md) | What the design takes for granted, and what breaks if it changes |
| [docs/testing.md](docs/testing.md) | Test layers, what each proves, CI, coverage gaps |
| [docs/load-test.md](docs/load-test.md) | Server throughput, in-browser timings, PDF export timings |

## Structure

```
index.html            entry page (nginx, dev server)
artifact.html         same markup for the hosted Claude artifact
css/styles.css        app interface, light/dark, responsive
css/templates.css     document templates (A4 page)
js/app.js             router; home, templates and documents views
js/editor.js          editor: on-page editing, tool rail, form and coach panels
js/tools.js           ATS checker and job matcher views
js/preview.js         scales A4 pages to fit
js/pdf-export.js      PDF: page picture (backgrounds, icons) + photo JPEG + text
js/pdf-text.js        real text in the embedded font, bullets, decorations
fonts/                font files embedded in PDFs (SIL Open Font License)
js/paginate.js        page breaks that keep blocks whole
js/importer.js        PDF/TXT import and résumé text parsing
js/richtext.js        pasted HTML and in-page edits → letter markup
js/platform.js        CDN libraries (pinned, integrity-checked), file saving
js/photo.js           crops and shrinks an uploaded profile photo
js/ui.js              DOM helpers, toast, dialogs
js/store.js           localStorage persistence with cross-tab merge
js/history.js         undo/redo snapshot list
js/analysis.js        coach, ATS check, keyword matcher
js/templates.js       document → HTML string, escaping
js/data.js            document model, validation, samples
tests/unit/           Node unit tests
tests/e2e/            Playwright browser tests
scripts/              dev server, load test, benchmarks
docs/                 architecture and design documents
Dockerfile, nginx.conf, docker-compose.yml
.github/workflows/ci.yml
```

## Not included

Password reset by email, other sign-in methods (Google and so on), payments, and language-model writing. The coaching features are rule-based and run locally; `draftLetterBody` and `strengthenBullet` are where a model could be plugged in.
