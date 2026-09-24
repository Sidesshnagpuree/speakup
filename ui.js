import { I } from './icons.js';

/** Tiny DOM builder. Text children are always inserted as text (never HTML). */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v; // only ever used with trusted icon markup
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === '') continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const icon = (name, cls) => h('span', { class: 'ico' + (cls ? ' ' + cls : ''), style: { display: 'inline-flex' }, html: I[name] || '' });

export function iconBtn(name, label, onClick, extra = {}) {
  return h('button', { class: 'icon-btn', 'aria-label': label, title: label, onclick: onClick, html: I[name], ...extra });
}

export function btn(label, onClick, { cls = '', ico = null, attrs = {} } = {}) {
  return h('button', { class: 'btn ' + cls, onclick: onClick, ...attrs }, ico ? icon(ico) : null, label);
}

/* ---------- Toast ---------- */
let toastTimer = null;
export function toast(message, { action = null, onAction = null, ms = 3200 } = {}) {
  const el = document.getElementById('toast');
  el.replaceChildren(h('span', null, message));
  if (action) el.append(h('button', { onclick: () => { hide(); onAction?.(); } }, action));
  el.classList.add('show');
  clearTimeout(toastTimer);
  const hide = () => el.classList.remove('show');
  toastTimer = setTimeout(hide, ms);
}

/* ---------- Bottom sheets (with Android back-button support) ---------- */
const stack = [];
let popping = false;
let ignorePops = 0;

window.addEventListener('popstate', () => {
  if (ignorePops > 0) { ignorePops--; return; }
  const top = stack[stack.length - 1];
  if (top) { popping = true; top.close(); popping = false; }
});

export function openSheet({ title = '', content, full = false, onClose = null, dismissable = true, headExtra = null }) {
  const root = document.getElementById('sheets');
  const body = h('div', { class: 'sheet-body' });
  const closeBtn = dismissable ? iconBtn('x', 'Close', () => api.close()) : null;
  const sheet = h('div', { class: 'sheet' + (full ? ' full' : ''), role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' },
    h('div', { class: 'grabber' }),
    (title || closeBtn || headExtra) ? h('div', { class: 'sheet-head' }, h('h2', null, title), headExtra, closeBtn) : null,
    body);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: () => dismissable && api.close() });
  const wrap = h('div', { class: 'sheet-wrap' }, backdrop, sheet);
  let closed = false;
  let pushed = false;
  const api = {
    el: sheet, body,
    setTitle(t) { const hh = sheet.querySelector('.sheet-head h2'); if (hh) hh.textContent = t; },
    close() {
      if (closed) return;
      closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      wrap.remove();
      if (!popping && pushed) { ignorePops++; try { history.back(); } catch (e) { ignorePops--; } }
      onClose?.();
    },
  };
  if (typeof content === 'function') content(body, api); else if (content) body.append(content);
  root.append(wrap);
  stack.push(api);
  try { history.pushState({ sheet: stack.length }, ''); pushed = true; } catch (e) { /* ignore */ }
  if (dismissable) {
    const onKey = (e) => { if (e.key === 'Escape' && stack[stack.length - 1] === api) api.close(); };
    document.addEventListener('keydown', onKey);
    const origClose = api.close;
    api.close = () => { document.removeEventListener('keydown', onKey); origClose(); };
  }
  return api;
}

export function confirmSheet(message, { ok = 'OK', cancel = 'Cancel', danger = false, detail = '' } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const s = openSheet({
      title: message,
      content: (body, api) => {
        if (detail) body.append(h('p', { class: 'muted', style: { marginTop: '0' } }, detail));
        body.append(h('div', { class: 'row', style: { marginTop: '8px' } },
          h('button', { class: 'btn grow', onclick: () => api.close() }, cancel),
          h('button', { class: 'btn grow ' + (danger ? 'danger' : 'primary'), onclick: () => { result = true; api.close(); } }, ok)));
      },
      onClose: () => resolve(result),
    });
    return s;
  });
}

/* ---------- Form helpers ---------- */
export function seg(options, value, onChange) {
  const wrap = h('div', { class: 'seg', role: 'group' });
  const render = (v) => {
    wrap.replaceChildren(...options.map(([val, label]) =>
      h('button', { type: 'button', 'aria-pressed': String(val === v), onclick: () => { render(val); onChange(val); } }, label)));
  };
  render(value);
  return wrap;
}

export function toggle(label, checked, onChange, sub = '') {
  const input = h('input', { type: 'checkbox', checked, role: 'switch', 'aria-label': label, onchange: (e) => onChange(e.target.checked) });
  return h('label', { class: 'switch' },
    h('div', null, h('div', { class: 'label' }, label), sub ? h('small', null, sub) : null),
    h('span', { class: 'toggle' }, input, h('span')));
}

export function field(label, control, hint = '') {
  // Only wrap real form inputs in <label>; a <label> around a button group would "click" its first button.
  const isInput = /^(INPUT|TEXTAREA|SELECT)$/.test(control?.tagName || '');
  return h(isInput ? 'label' : 'div', { class: 'field' }, h('span', { class: 'label' }, label), control, hint ? h('small', null, hint) : null);
}

export function dots() { return h('span', { class: 'dots', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')); }

export function ring(value, max, { size = 96, stroke = 9, color = 'var(--accent)', label = '' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, max ? value / max : 0));
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  const mk = (stk, dash) => {
    const el = document.createElementNS(ns, 'circle');
    el.setAttribute('cx', size / 2); el.setAttribute('cy', size / 2); el.setAttribute('r', r);
    el.setAttribute('fill', 'none'); el.setAttribute('stroke', stk); el.setAttribute('stroke-width', stroke);
    if (dash != null) { el.setAttribute('stroke-dasharray', `${dash} ${c}`); el.setAttribute('stroke-linecap', 'round'); }
    return el;
  };
  svg.append(mk('var(--surface-2)'), mk(color, frac * c));
  return h('div', { class: 'ring', role: 'img', 'aria-label': label || `${value} of ${max}` }, svg);
}

export function relTime(ts) {
  const d = new Date(ts);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return d.toLocaleDateString(undefined, { weekday: 'long' });
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}
