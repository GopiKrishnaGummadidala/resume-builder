// Small DOM helpers and in-page dialogs shared by the views.
// Dialogs are built in-page because confirm()/prompt() are unavailable in sandboxed hosts.
import { esc } from './templates.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Navigate to a view; the router reacts to the hash change. */
export const go = hash => { location.hash = hash; };

export const timeAgo = ts => {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
};

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const keysOf = path => {
  const keys = path.split('.');
  if (keys.some(k => UNSAFE_KEYS.has(k))) throw new Error(`Unsafe path: ${path}`);
  return keys;
};
/** Set `obj.a.b.c` from the path "a.b.c". Paths come from data-path attributes the app renders. */
export function setPath(obj, path, value) {
  const keys = keysOf(path);
  let o = obj;
  keys.slice(0, -1).forEach(k => (o = o[k]));
  o[keys[keys.length - 1]] = value;
}
export function getPath(obj, path) { return keysOf(path).reduce((o, k) => (o == null ? o : o[k]), obj); }

/** Show a short notice. Only one is shown at a time: a new notice replaces the current one. */
export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach(old => old.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Show a modal; resolves with whatever `wire` passes to done(). Escape or a backdrop click cancels. */
function modal(html, wire, cancelValue) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = html;
    const opener = document.activeElement;
    const done = v => {
      wrap.remove();
      document.removeEventListener('keydown', onKey);
      opener?.focus?.();
      resolve(v);
    };
    const onKey = e => { if (e.key === 'Escape') done(cancelValue); };
    wrap.addEventListener('click', e => { if (e.target === wrap || e.target.closest('[data-cancel]')) done(cancelValue); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(wrap);
    wire(wrap, done);
  });
}

/** In-page confirmation. Resolves true or false. */
export function confirmDialog(message, okLabel = 'Confirm', danger = false) {
  return modal(
    `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-msg">
      <p id="modal-msg">${esc(message)}</p>
      <div class="cta-row"><button class="btn btn-ghost" data-cancel>Cancel</button><button class="btn ${danger ? 'btn-danger-solid' : 'btn-primary'}" data-ok>${esc(okLabel)}</button></div>
    </div>`,
    (wrap, done) => {
      const ok = wrap.querySelector('[data-ok]');
      ok.addEventListener('click', () => done(true));
      ok.focus();
    },
    false
  );
}

/** Ask for a file name. Resolves "<name>.<ext>", or null if cancelled. */
export function fileNameDialog(defaultName, ext = 'pdf') {
  return modal(
    `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="fn-title">
      <h3 id="fn-title">Download ${esc(ext.toUpperCase())}</h3>
      <label class="field" for="fn-input"><span>File name</span>
        <div class="fn-row"><input id="fn-input" type="text" value="${esc(defaultName)}" autocomplete="off" spellcheck="false"><span class="muted">.${esc(ext)}</span></div>
      </label>
      <p class="fn-error small" hidden>Enter a file name.</p>
      <div class="cta-row"><button type="button" class="btn btn-ghost" data-cancel>Cancel</button><button type="submit" class="btn btn-primary">⬇ Download</button></div>
    </form>`,
    (wrap, done) => {
      const input = wrap.querySelector('#fn-input');
      wrap.querySelector('form').addEventListener('submit', e => {
        e.preventDefault();
        const name = cleanFileName(input.value, ext);
        if (!name) { wrap.querySelector('.fn-error').hidden = false; input.focus(); return; }
        done(`${name}.${ext}`);
      });
      input.focus();
      input.select();
    },
    null
  );
}

/** Strip characters Windows and macOS do not allow in file names, and a typed extension. */
export function cleanFileName(value, ext) {
  return String(value)
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(new RegExp(`\\.${ext}$`, 'i'), '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}
