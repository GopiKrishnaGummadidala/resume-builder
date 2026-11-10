# Craftfolio — CV & Cover Letter Builder

A dependency-free, browser-only CV/resume and cover letter builder, inspired by the feature set of online resume builders such as novoresume.com.

## Run with Docker Compose

```bash
docker compose up -d --build
```

Then open http://localhost:8090. The image is nginx serving the static files.

- Change the port: `CRAFTFOLIO_PORT=9000 docker compose up -d`
- Rebuild after editing files: `docker compose up -d --build`
- Stop: `docker compose down`

Documents are saved in each visitor's browser (localStorage), so the container keeps no data and needs no volume.

## Your default details

New CVs and cover letters start with the name, headline, email, phone, location and links from `js/profile.local.js`. Every field stays editable per document, and **↺ Reset to my details** in the Personal details section restores them.

The file is git-ignored so your contact details stay out of the repo. To set it up on another machine, copy `js/profile.example.js` to `js/profile.local.js` and fill it in. Without it, new documents start empty. Docker builds include it, so rebuild after editing: `docker compose up -d --build`.

## Run without Docker

From this folder:

```bash
python -m http.server 5180
```

Then open http://localhost:5180. (Must be served over HTTP — ES modules don't load from `file://`.)

## Features
- **CV builder** — 6 templates (Classic, Minimal, Executive, Tech = single-column/ATS; Modern, Compact = two-column), 8 colours, 4 fonts, live A4 preview, reorderable sections.
- **Cover letter builder** — same templates so CV + letter match; "Draft from a CV" writes a first draft from your headline, latest role and skills; copy personal details from a CV.
- **Live coach** — score + tips (action verbs, quantified bullets, 3–6 bullets per role, summary length, pronouns, consistency; letter length, placeholders, recipient).
- **✨ Strengthen bullets** — rewrites weak openers ("Responsible for…" → "Managed…").
- **ATS Checker** — upload PDF/TXT, paste text or pick a saved CV; grouped checks + score; "rebuild in an ATS template".
- **Job Matcher** — compares a CV with a job ad: matched / close / missing keywords; duplicate & tailor.
- **Import** — PDF (pdf.js loaded on demand from cdnjs), TXT, or JSON export. Parsing is best-effort.
- **Download PDF** — via the browser print dialog ("Save as PDF"), real selectable text.
- **Storage** — everything stays in `localStorage`; export JSON for backups.

## Structure
```
index.html
css/styles.css      app UI, responsive + print rules
css/templates.css   document template styles
js/app.js           hash router, pages, editor, tools
js/data.js          data model, persistence, samples, letter drafting
js/templates.js     template registry + CV/letter renderers
js/analysis.js      coach, ATS check, keyword matcher
js/importer.js      PDF/text import and parsing
artifact.html       same page for the hosted Claude artifact
Dockerfile          nginx image; nginx.conf sets JS MIME type and no-cache
docker-compose.yml  single "web" service on port 8090
```

## Not included (vs. a commercial site)
Accounts/cloud sync, payments, and LLM-powered writing. The AI-style features are rule-based and run offline; an LLM API could be plugged into `draftLetterBody` / `strengthenBullet` later.
