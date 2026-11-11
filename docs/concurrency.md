# Concurrency

Craftfolio has no server-side state, so "concurrency" here means three things: several browser tabs sharing one storage entry, asynchronous work inside a tab, and many visitors downloading the static files.

## 1. Several tabs, one storage entry

### The problem
Each tab keeps its own in-memory copy of the document library and `localStorage` has no transactions. The original implementation wrote its whole copy on every save, so:

- Tab A and tab B both open. A creates a CV. B (which has never seen it) saves a letter → **A's CV is gone from storage.**
- A deletes a document. B, still holding it in memory, saves → **the deleted document comes back.**

### The design: read–merge–write, per document

Implemented in `js/store.js` as two pure functions (`parseState`, `mergeStates`) plus a thin stateful wrapper.

**Every save** reads the current stored value, merges it with the tab's memory, and writes the result.

**Merge rules**

| Situation | Result |
|---|---|
| Document exists on one side only | Kept |
| Same id on both sides | The copy with the larger `updatedAt` wins. A tie keeps the local object, so an open editor keeps editing the same object |
| Document deleted on one side | A tombstone `deleted[id] = time` removes it on the other side |
| Document edited *after* it was deleted elsewhere | The edit wins and the tombstone is dropped (losing work is worse than keeping a document) |
| Tombstone older than 30 days | Forgotten |

**Hearing about other tabs.** The browser fires a `storage` event in every *other* tab after a write. The store merges, tells subscribers which ids changed, and the views react:

- list views re-render;
- an open editor reloads **only if its own document changed**, with a notice ("changed in another tab" / "deleted in another tab");
- otherwise the editor is left alone, so typing is never interrupted by unrelated changes.

**Self-healing.** The read and the write of a save are synchronous and take microseconds, but two tabs are separate processes and the browser gives no lock, so in principle tab B can read, tab A can write, and tab B can then write a value that lacks A's change. When A receives B's `storage` event it compares storage with its memory; if storage is missing anything A has, A writes the merged state back. B then sees nothing new and stays quiet, so the tabs converge and cannot ping-pong. A unit test simulates exactly this overwritten write.

### What this guarantees, and what it does not

| Guaranteed | Not guaranteed |
|---|---|
| A document created in any tab is never erased by another tab's save | Merging two tabs' edits to the **same** document. The later save replaces the earlier one, whole document |
| A deleted document does not come back from a stale tab | Correct ordering if the computer's clock jumps backwards between two edits (same device, so in practice this needs a manual clock change) |
| Tabs converge to the same library without a reload | Sync between devices or browsers. There is none |
| A pending edit is written when the tab is hidden or closed | An edit typed in the last instant before a crash or power loss (at most 300 ms of typing) |

Whole-document last-write-wins was chosen over field-level merging because the realistic case is one person with two tabs, not two people; see [design-rationale.md](design-rationale.md). The Web Locks API (`navigator.locks`) would give real cross-tab mutual exclusion, but it is asynchronous, and saves must also work synchronously while a page is being closed.

### Write timing

| Call | When | Used for |
|---|---|---|
| `store.update(doc)` | Immediately | Structural changes: add/remove/reorder items, template, colour, font |
| `store.touch(doc)` | After 300 ms without further input | Typing |
| `store.flush()` | On `pagehide` and when the tab becomes hidden | Makes sure a pending `touch` is never lost on close, reload or tab switch |

### Storage failures
If a write throws (quota exceeded, storage blocked by the browser), the document stays usable in memory, and the person is told once per failure streak to use "Export JSON". Saving resumes on its own when storage works again. Corrupt stored data is read as an empty library instead of crashing the app.

## 2. Asynchronous work inside one tab

JavaScript in a tab runs on one thread, so there are no data races on the document object. The async paths and their guards:

| Operation | Hazard | Guard |
|---|---|---|
| PDF export (about 0.4 s, longer on first use) | Clicking Download twice | The button is disabled until the build finishes; the file-name dialog is modal |
| Loading a CDN library | Two features requesting the same library at once; a failed load being cached forever | `loadLib()` keeps one promise per library and forgets it on failure so a retry works |
| Debounced save | Navigating away within 300 ms | The timer belongs to the store, not the editor view, so it still fires; `flush()` covers closing the tab |
| Off-screen PDF render area | Left visible or left full of markup after an error | Emptied and hidden in a `finally` block |
| Editing on the page while the form re-renders | Caret jumping or lost keystrokes | The page is not re-rendered while it has focus |
| View switches | Listeners from the previous view firing | Listeners are attached to the view's own root element, which is replaced on navigation; the resize observer is disconnected on each route change |
| Dialogs | Stray global key handlers | The key listener is removed when the dialog closes; focus returns to the element that opened it |

PDF import runs pdf.js on the main thread on purpose: cross-origin Web Workers are blocked in sandboxed hosts. A long PDF can make the tab unresponsive for a moment while it is read.

## 3. Many visitors

The server holds no sessions and no data, so visitors do not interact with each other at all. Any number of nginx containers can sit behind a load balancer with no coordination. Measured throughput of one container is in [load-test.md](load-test.md).

In CI, a newer push cancels the run still in progress for the same branch (`concurrency` group in `.github/workflows/ci.yml`).
