// Everything that depends on where the app runs: third-party libraries from the CDN and saving files.
// The same code runs from nginx/Docker, a plain static server, and as a hosted Claude artifact.
import { toast } from './ui.js';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/';

/**
 * Third-party libraries, loaded on demand (none are needed to open the app).
 * Versions are pinned and each file carries a Subresource Integrity hash, so a changed or
 * tampered CDN file is refused by the browser instead of running.
 */
const LIBS = {
  html2canvas: { path: 'html2canvas/1.4.1/html2canvas.min.js', integrity: 'sha384-ZZ1pncU3bQe8y31yfZdMFdSpttDoPmOZg2wguVK9almUodir1PghgT0eY7Mrty8H', global: 'html2canvas' },
  jspdf: { path: 'jspdf/2.5.1/jspdf.umd.min.js', integrity: 'sha384-JcnsjUPPylna1s1fvi1u12X5qjY5OL56iySh75FdtrwhO/SWXgMjoVqcKyIIWOLk', global: 'jspdf' },
  pako: { path: 'pako/2.1.0/pako.min.js', integrity: 'sha384-rNlaE5fs9dGIjmxWDALQh/RBAaGRYT5ChrzHo6tRfgrZ36iRFAiquP5g41Jsv+0j', global: 'pako' },
  upng: { path: 'upng-js/2.1.0/UPNG.min.js', integrity: 'sha384-ZL3zm2yr6WhKklr+limPN2KaWCW0x8rd9QIg3jabcFyrF6wB/h7VgythzrDTAI2O', global: 'UPNG' },
  pdfjsWorker: { path: 'pdf.js/3.11.174/pdf.worker.min.js', integrity: 'sha384-SnzOobpRMLXZ52iJvZm/C0fYw0OQemTXzTjIsdsfMcrCtCEe9qgzxTd3RSklO5x2', global: 'pdfjsWorker' },
  pdfjs: { path: 'pdf.js/3.11.174/pdf.min.js', integrity: 'sha384-/1qUCSGwTur9vjf/z9lmu/eCUYbpOTgSjmpbMQZ1/CtX2v/WcAIKqRv+U1DUCG6e', global: 'pdfjsLib' },
};
export const libUrl = name => CDN + LIBS[name].path;

const pending = new Map();
/** Load a library once and resolve with its global. Rejects with a readable error when offline or blocked. */
export function loadLib(name) {
  const lib = LIBS[name];
  if (!lib) return Promise.reject(new Error(`Unknown library: ${name}`));
  if (window[lib.global]) return Promise.resolve(window[lib.global]);
  if (!pending.has(name)) {
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = CDN + lib.path;
      s.integrity = lib.integrity;
      s.crossOrigin = 'anonymous';
      s.onload = () => resolve(window[lib.global]);
      s.onerror = () => { s.remove(); reject(new Error(`Could not load ${name} (offline, or the download was blocked)`)); };
      document.head.appendChild(s);
    });
    p.catch(() => pending.delete(name)); // allow a retry after a failure
    pending.set(name, p);
  }
  return pending.get(name);
}

/** True inside a hosted Claude artifact, where print, confirm and plain downloads are blocked. */
export const hosted = () => typeof window.claude?.use === 'function';

/** Save a generated file: through the host's downloads capability when hosted, else a browser download. */
export async function saveFile(filename, data) {
  if (hosted()) {
    const downloads = await window.claude.use('downloads');
    if (!downloads) { toast('Saving files is not available in this view'); return false; }
    try {
      await downloads.save({ filename, data });
      return true;
    } catch (err) {
      if (err?.code !== 'declined') toast(`Could not save: ${err?.message || err?.code || 'unknown error'}`);
      return false;
    }
  }
  const blob = data instanceof Blob ? data : new Blob([data]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return true;
}
