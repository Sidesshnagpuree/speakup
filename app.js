import { h, toast } from './ui.js';
import { I } from './icons.js';
import { store, getApiKey, dueMistakes } from './store.js';
import { PROVIDERS, providerId } from './ai.js';
import { createTalk } from './talk.js';
import { createRoleplay } from './roleplay.js';
import { createReview } from './review.js';
import { createProgress } from './progress.js';
import { openSettings, openOnboarding } from './settings.js';
import { speaker, listener } from './speech.js';

const TABS = [
  { id: 'talk', label: 'Talk', icon: 'chat' },
  { id: 'roleplay', label: 'Role-play', icon: 'briefcase' },
  { id: 'review', label: 'Review', icon: 'book' },
  { id: 'progress', label: 'Progress', icon: 'chart' },
];

const app = {
  views: {},
  current: null,

  applyTheme() {
    const t = store.state.settings.theme;
    const root = document.documentElement;
    if (t === 'light' || t === 'dark') root.setAttribute('data-theme', t); else root.removeAttribute('data-theme');
    const dark = t === 'dark' || (t !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1015' : '#f6f7fb');
  },

  show(id, { push = true } = {}) {
    if (!this.views[id]) id = 'talk';
    if (this.current === id) return;
    const prev = this.views[this.current];
    prev?.onHide?.();
    prev?.el.classList.remove('active');
    this.current = id;
    const v = this.views[id];
    v.el.classList.add('active');
    v.onShow?.();
    this.updateHeader();
    document.querySelectorAll('#tabbar button').forEach((b) => {
      if (b.dataset.tab === id) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    if (push) { try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ } }
  },

  updateHeader() {
    const v = this.views[this.current];
    if (!v) return;
    document.getElementById('title').textContent = v.title;
    const p = PROVIDERS[providerId()];
    const pill = h('button', {
      class: 'engine-pill', type: 'button', title: 'AI engine — tap to change',
      onclick: () => import('./settings.js').then((m) => m.openSettings(app)),
    }, p.label, p.tag === 'free' ? h('span', null, 'free') : null);
    document.getElementById('topbar-actions').replaceChildren(pill, ...(v.actions?.() || []));
  },

  refreshBadges() {
    const due = dueMistakes().length;
    const b = document.querySelector('#tabbar button[data-tab="review"]');
    if (!b) return;
    b.querySelector('.tab-badge')?.remove();
    if (due) b.append(h('span', { class: 'tab-badge', 'aria-label': `${due} to practise` }, due > 99 ? '99+' : String(due)));
  },

  refreshAll() {
    this.applyTheme();
    for (const v of Object.values(this.views)) {
      if (v.chat?.busy || v.chat?.listening) continue; // don't interrupt a live conversation
      v.refresh?.();
    }
    this.updateHeader();
    this.refreshBadges();
  },

  /** Jump to Talk and start a guided drill (used by the phrasebook). */
  startDrill(prompt) {
    this.show('talk');
    this.views.talk?.startDrill?.(prompt);
  },

  needKey() {
    toast(`Add your ${PROVIDERS[providerId()].label} API key first`, { action: 'Set up', onAction: () => openOnboarding(app, { startStep: 2 }), ms: 5000 });
  },
};

function init() {
  app.applyTheme();
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => app.applyTheme());

  document.getElementById('btn-settings').innerHTML = I.gear;
  document.getElementById('btn-settings').addEventListener('click', () => openSettings(app));

  const tabbar = document.getElementById('tabbar');
  tabbar.replaceChildren(...TABS.map((t) => h('button', { type: 'button', 'data-tab': t.id, onclick: () => app.show(t.id) },
    h('span', { style: { display: 'inline-flex' }, html: I[t.icon] }), t.label)));

  const viewsEl = document.getElementById('views');
  const makers = { talk: createTalk, roleplay: createRoleplay, review: createReview, progress: createProgress };
  for (const t of TABS) {
    const v = makers[t.id](app);
    app.views[t.id] = v;
    viewsEl.append(v.el);
  }

  const start = (location.hash || '').slice(1);
  app.show(app.views[start] ? start : (store.state.rp.active ? 'roleplay' : 'talk'), { push: false });
  app.refreshBadges();

  // stop the mic and voice when the app goes to the background
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      listener.cancel();
      speaker.stop();
      Object.values(app.views).forEach((v) => v.chat?.pause?.());
    } else {
      app.refreshBadges();
      if (app.current === 'progress' || app.current === 'review') app.views[app.current].refresh();
    }
  });

  if (!store.state.settings.onboarded && !getApiKey()) openOnboarding(app);

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'activated' && navigator.serviceWorker.controller) {
            toast('SpeakUp was updated', { action: 'Reload', onAction: () => location.reload(), ms: 8000 });
          }
        });
      });
    }).catch(() => { /* offline support is optional */ });
  }
}

init();
window.speakup = app; // handy for debugging
