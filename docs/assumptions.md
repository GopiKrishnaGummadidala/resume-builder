# Assumptions

What the design takes for granted. If one of these stops being true, the linked decision should be revisited.

## Users and usage

| # | Assumption | If it is wrong |
|---|---|---|
| A1 | One person uses the app on their own device. There are no accounts and no shared documents. | Sharing or multi-device use needs a backend and a different merge strategy ([design-rationale.md](design-rationale.md) §1, §7) |
| A2 | A person keeps tens of documents, not thousands. | The documents view draws a live preview per document and would need paging or cached thumbnails. Storage itself is fine up to roughly 1,500 documents (5 MB quota, about 2–3 KB each) |
| A3 | A person may have several tabs open, but edits one document in one tab at a time. | Simultaneous edits to the same document resolve as last-write-wins for the whole document ([concurrency.md](concurrency.md)) |
| A4 | Documents are written in a Latin script. | The visible page works for any script the typeface covers, but the hidden PDF text layer keeps only Latin-1 characters, so text extraction would be incomplete |
| A5 | CVs and letters target A4 paper. | US Letter would need a second page size in `templates.js` (`PAGE`) and in the PDF export |
| A6 | A cover letter is one page; a CV is one or two. | Longer documents export correctly (pages are sliced), but a page break can fall through a line of text because the page is cut at a fixed height |

## Environment

| # | Assumption | If it is wrong |
|---|---|---|
| E1 | A current desktop browser: Chrome/Edge 111+, Safari 16.4+, Firefox 136+ (ES modules, top-level `await`, `structuredClone`, `color-mix`, `contenteditable="plaintext-only"`). | Older browsers fail to load the modules. Firefox before 136 loses in-page editing of the four single-line fields only |
| E2 | `localStorage` is available and holds about 5 MB. | In private windows or with storage blocked, the app still works for the session and reports once that it cannot save |
| E3 | The device clock does not jump backwards between edits. | Last-write-wins compares timestamps; a backwards jump could make an older copy win |
| E4 | cdnjs and Google Fonts are reachable the first time PDF export or import is used, and for the typefaces. | Without them the editor still works with fallback fonts; export and import show a clear error. PDFs made with a fallback font would not match the intended typography |
| E5 | The page is served over HTTP(S), not opened from `file://`. | Browsers refuse to load ES modules from `file://` |
| E6 | Screens are at least tablet width for comfortable editing. | The layout stacks on phones and works, but the page preview is small |

## Data

| # | Assumption | If it is wrong |
|---|---|---|
| D1 | Field sizes stay within the limits in `data.js`: 300 characters for short fields, 5,000 for long ones, 20,000 for a letter body, 50 items per list. | Longer input is cut at import/load time. The limits bound memory, rendering time and storage |
| D2 | Imported JSON may be hostile; imported PDFs and text are untrusted too. | Already treated that way: everything passes `normalizeDoc()` and is escaped on output |
| D3 | Free-text CV parsing (PDF/TXT import) is a starting point that the person reviews. | It is heuristic: headings in English, one column, conventional section names. The app says so after every import |
| D4 | Document ids only need to be unique within one browser. | They are 8 random base-36 characters from `Math.random()`, which is not suitable as a secret or for global uniqueness |
| D5 | The optional `js/profile.local.js` holds only the owner's own contact details. | It is served as a public static file by any image built with it. It must not hold anything secret |

## Operations

| # | Assumption | If it is wrong |
|---|---|---|
| O1 | The container sits behind something that terminates TLS (a reverse proxy or platform ingress) when exposed beyond localhost. | nginx here listens on plain HTTP port 8080 only; add TLS in front, and consider `Strict-Transport-Security` there |
| O2 | No server-side logging of personal data is possible, because none reaches the server. | True as long as nothing is added that posts document data anywhere |
| O3 | Rebuilding the image is the deployment. Files are served with `no-cache` and ETags, so visitors get a new build on their next page load. | A CDN in front would need its own cache rules |
| O4 | CI runs on GitHub-hosted Ubuntu runners with network access (npm, the Playwright browser download, cdnjs and Google Fonts during browser tests). | An air-gapped runner would need the browser and the CDN libraries provided locally |

## Out of scope (by decision)

- Accounts, cloud sync, sharing links.
- Payments or plan tiers.
- Language-model writing assistance (see [design-rationale.md](design-rationale.md) §9).
- Server-side PDF rendering.
- Accessibility of the *generated PDF* beyond selectable text (no tagged structure).
