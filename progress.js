import { h, btn, ring, relTime, toast } from './ui.js';
import { I } from './icons.js';
import { store, todayKey, streakInfo, dayStats, usageSummary } from './store.js';
import { PROVIDERS, providerId } from './ai.js';
import { typeLabel } from './prompts.js';

const fmtUsd = (n) => (n < 0.01 && n > 0 ? '< $0.01' : '$' + n.toFixed(2));

export function createProgress(app) {
  const el = h('section', { class: 'view scroll', id: 'view-progress', 'aria-label': 'Progress' });

  function last7() {
    const out = [];
    const d = new Date();
    d.setDate(d.getDate() - 6);
    for (let i = 0; i < 7; i++) {
      const k = todayKey(d);
      const s = store.state.stats.days[k] || { msgs: 0, checked: 0, correct: 0 };
      out.push({ key: k, label: d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3), msgs: s.msgs, checked: s.checked, correct: s.correct, today: i === 6 });
      d.setDate(d.getDate() + 1);
    }
    return out;
  }

  function render() {
    const st = store.state;
    const sk = streakInfo();
    const today = dayStats();
    const goal = Number(st.settings.dailyGoal) || 20;
    const week = last7();
    const days = Object.values(st.stats.days);
    const totalMsgs = days.reduce((a, d) => a + d.msgs, 0);
    const totalWords = days.reduce((a, d) => a + d.words, 0);
    const wk = week.reduce((a, d) => ({ c: a.c + d.checked, ok: a.ok + d.correct }), { c: 0, ok: 0 });
    const acc = wk.c ? Math.round((wk.ok / wk.c) * 100) : null;

    el.replaceChildren();
    const wrap = h('div', { class: 'pad stack' });

    // streak + goal
    const g = ring(Math.min(today.msgs, goal), goal, { size: 64, stroke: 7, color: 'var(--teal)', label: `Today: ${today.msgs} of ${goal} sentences` });
    g.append(h('div', { class: 'val' }, `${today.msgs}/${goal}`));
    wrap.append(h('div', { class: 'card streak' },
      h('div', { class: 'flame', html: I.flame }),
      h('div', null,
        h('div', { class: 'v' }, `${sk.current}-day streak`),
        h('div', { class: 'muted small' }, sk.doneToday ? `Best: ${sk.best} ${sk.best === 1 ? 'day' : 'days'}` : (sk.current ? 'Practise today to keep it going' : 'Say one sentence today to start'))),
      h('div', { class: 'goal' }, g, h('div', { class: 'muted small' }, 'today'))));

    // stat tiles
    wrap.append(h('div', { class: 'stats-grid' },
      tile(totalMsgs.toLocaleString(), 'sentences spoken'),
      tile(acc == null ? '—' : acc + '%', 'correct this week'),
      tile(totalWords.toLocaleString(), 'words spoken'),
      tile(String(sk.totalDays), sk.totalDays === 1 ? 'day practised' : 'days practised')));

    // 7-day bars
    const max = Math.max(goal, ...week.map((d) => d.msgs), 1);
    const bars = h('div', { class: 'bars', role: 'img', 'aria-label': 'Sentences per day, last 7 days: ' + week.map((d) => `${d.label} ${d.msgs}`).join(', ') });
    const tip = h('div', { class: 'muted small', style: { minHeight: '20px', marginTop: '6px' } }, 'Tap a bar for details');
    week.forEach((d) => {
      const col = h('button', {
        class: 'bar-col' + (d.today ? ' today' : '') + (d.msgs ? '' : ' zero'), type: 'button',
        'aria-label': `${d.label}: ${d.msgs} sentences`,
        onclick: () => {
          const a = d.checked ? ` · ${Math.round((d.correct / d.checked) * 100)}% correct` : '';
          tip.textContent = `${new Date(d.key + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}: ${d.msgs} sentences${a}`;
        },
      },
      (d.today || d.msgs === Math.max(...week.map((x) => x.msgs))) && d.msgs ? h('span', { class: 'bv', style: { bottom: (d.msgs / max) * 100 + '%' } }, String(d.msgs)) : null,
      h('div', { class: 'bar', style: { height: Math.max(d.msgs ? 3 : 1.5, (d.msgs / max) * 100) + '%' } }));
      bars.append(col);
    });
    const goalPct = (goal / max) * 100;
    bars.append(h('div', { class: 'goal-line', style: { bottom: `calc(${goalPct}% * (150 - 18) / 150)` }, 'aria-hidden': 'true' }, h('span', null, 'goal')));
    wrap.append(h('div', { class: 'card' },
      h('h3', null, 'Sentences per day'),
      h('div', { class: 'muted small', style: { marginBottom: '6px' } }, `Last 7 days · daily goal ${goal}`),
      bars,
      h('div', { class: 'bar-labels' }, week.map((d) => h('span', { class: d.today ? 'today' : '' }, d.today ? 'Today' : d.label))),
      tip));

    // mistake types
    const types = Object.entries(st.stats.types).sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (types.length) {
      const tmax = types[0][1];
      wrap.append(h('div', { class: 'card' },
        h('h3', null, 'Your most common mistakes'),
        h('div', { class: 'muted small', style: { marginBottom: '6px' } }, 'Focus on the top one this week'),
        types.map(([t, n]) => h('div', { class: 'hbar' },
          h('span', null, typeLabel(t)),
          h('div', { class: 'track' }, h('div', { class: 'fill', style: { width: (n / tmax) * 100 + '%' } })),
          h('span', { class: 'n' }, String(n))))));
    }

    // role-play scores
    const hist = st.rp.history.filter((r) => r.report).slice(-6).reverse();
    if (hist.length) {
      wrap.append(h('div', { class: 'card' },
        h('h3', null, 'Role-play scores'),
        h('div', { class: 'list', style: { boxShadow: 'none', marginTop: '8px' } }, hist.map((r) =>
          h('div', { class: 'list-item' },
            h('div', { class: 'grow' }, h('b', null, r.title), h('span', null, relTime(r.date))),
            h('span', { class: 'score-pill' }, r.report.overall + '/10'))))));
    }

    // usage
    const u = usageSummary();
    const p = PROVIDERS[providerId()];
    wrap.append(h('div', { class: 'card' },
      h('h3', null, 'API usage (estimate)'),
      h('div', { class: 'kv' }, h('span', null, 'Today'), h('b', null, `${fmtUsd(u.today.cost)} · ${u.today.calls} calls`)),
      h('div', { class: 'kv' }, h('span', null, 'This month'), h('b', null, fmtUsd(u.month.cost))),
      h('div', { class: 'kv' }, h('span', null, 'All time'), h('b', null, fmtUsd(u.all.cost))),
      h('p', { class: 'muted small', style: { margin: '8px 0 0' } },
        p.tag === 'free'
          ? `You're on ${p.label}'s free tier, so these calls cost nothing. Calls made earlier on a paid engine are still counted above.`
          : 'Estimated from token counts at list prices. Your exact bill is in the provider\'s console.')));

    // backup
    wrap.append(h('div', { class: 'card' },
      h('h3', null, 'Backup'),
      h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Your progress is stored only on this phone. Export a backup before clearing browser data or switching phones.'),
      h('div', { class: 'row' },
        btn('Export', exportData, { cls: 'grow', ico: 'download' }),
        btn('Import', importData, { cls: 'grow', ico: 'upload' }))));

    el.append(wrap);
  }

  function tile(v, l) { return h('div', { class: 'stat' }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l)); }

  function exportData() {
    const blob = new Blob([JSON.stringify(store.state, null, 1)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: `speakup-backup-${todayKey()}.json` });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Backup downloaded (your API key is not included)');
  }

  function importData() {
    const input = h('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
    input.addEventListener('change', async () => {
      const f = input.files?.[0];
      input.remove();
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || typeof data !== 'object' || !data.stats || !data.settings) throw new Error('bad');
        store.replace(data);
        toast('Backup restored');
        app.refreshAll();
      } catch (e) {
        toast("That file isn't a SpeakUp backup.");
      }
    });
    document.body.append(input);
    input.click();
  }

  return {
    id: 'progress', el, title: 'Progress',
    actions: () => [],
    onShow() { render(); },
    onHide() {},
    refresh() { render(); },
  };
}
