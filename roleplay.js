import { h, icon, btn, openSheet, confirmSheet, toast, field, seg, toggle, ring, relTime } from './ui.js';
import { I } from './icons.js';
import { store, uid, getApiKey, addWord, hasWord } from './store.js';
import { Chat } from './chat.js';
import { callTool, reportModel } from './claude.js';
import { SCENARIOS, scenarioById, DIFFICULTY, roleplaySystem, ROLEPLAY_KICKOFF, REPORT_TOOL, reportSystem } from './prompts.js';
import { canSpeak, say, unlockAudio } from './speech.js';

const SCORE_LABELS = { grammar: 'Grammar', vocabulary: 'Vocabulary', fluency: 'Fluency', professionalism: 'Professional tone', content: 'Answer quality' };

export function createRoleplay(app) {
  const el = h('section', { class: 'view', id: 'view-roleplay', 'aria-label': 'Role-play' });
  let chat = null;
  let reportId = null;
  let starting = false;
  const rp = () => store.state.rp;
  const s = () => store.state.settings;

  function render() {
    if (chat) { chat.pause(); chat = null; }
    el.replaceChildren();
    el.classList.remove('scroll');
    if (rp().active) renderSession();
    else if (reportId) renderReport(reportId);
    else renderList();
    app.updateHeader();
    if (el.classList.contains('active')) el.style.display = '';
  }

  /* ---------- list ---------- */
  function renderList() {
    el.classList.add('scroll');
    const wrap = h('div', { class: 'pad' });
    wrap.append(h('p', { class: 'muted', style: { margin: '0 0 14px' } },
      'Practise real conversations. Your partner stays in character; at the end you get a scored feedback report.'));
    wrap.append(h('div', { class: 'scenario-grid' }, SCENARIOS.map((sc) =>
      h('button', { class: 'scenario', type: 'button', onclick: () => openSetup(sc) },
        h('span', { class: 'ic', html: I[sc.icon] || I.briefcase }),
        h('div', null, h('b', null, sc.title), h('span', null, sc.desc))))));

    const hist = rp().history.slice().reverse();
    if (hist.length) {
      wrap.append(h('div', { class: 'section-title' }, 'Past sessions'));
      wrap.append(h('div', { class: 'list' }, hist.slice(0, 15).map((r) =>
        h('button', { class: 'list-item', type: 'button', onclick: () => { reportId = r.id; render(); } },
          h('div', { class: 'grow' }, h('b', null, r.title), h('span', null, relTime(r.date) + (r.cfg?.role ? ' · ' + r.cfg.role : ''))),
          h('span', { class: 'score-pill' }, r.report ? String(r.report.overall) : '—')))));
    }
    el.append(wrap);
  }

  /* ---------- setup ---------- */
  function openSetup(sc) {
    const last = rp().lastCfg || {};
    const cfg = { role: last.role || '', company: last.company || '', difficulty: last.difficulty || 'realistic', corrections: last.corrections ?? true, extra: '', custom: '' };
    openSheet({
      title: sc.title,
      content: (body, api) => {
        body.append(h('p', { class: 'muted', style: { marginTop: 0 } }, sc.desc,
          sc.id !== 'custom' ? h('span', null, ` You'll talk to ${sc.partner}, the ${sc.partnerRole}.`) : null));
        const f = sc.fields || [];
        if (f.includes('role')) {
          body.append(field('Job role', h('input', { class: 'input', value: cfg.role, placeholder: 'e.g. Senior Consultant, Business Analyst', oninput: (e) => { cfg.role = e.target.value; } })));
        }
        if (f.includes('company')) {
          body.append(field('Company (optional)', h('input', { class: 'input', value: cfg.company, placeholder: 'e.g. a global bank', oninput: (e) => { cfg.company = e.target.value; } })));
        }
        if (f.includes('extra')) {
          body.append(field('Details (optional)', h('textarea', { class: 'input', rows: 3, placeholder: 'Anything that makes it realistic — your project, the reason for the delay, the numbers you\'ll present…', oninput: (e) => { cfg.extra = e.target.value; } })));
        }
        if (f.includes('custom')) {
          body.append(field('Describe the situation', h('textarea', { class: 'input', rows: 4, placeholder: 'e.g. I\'m returning a faulty laptop at a store and the manager doesn\'t want to give a refund.', oninput: (e) => { cfg.custom = e.target.value; } })));
        }
        body.append(h('div', { class: 'field' }, h('span', { class: 'label' }, 'Difficulty'),
          seg(Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), cfg.difficulty, (v) => { cfg.difficulty = v; })));
        body.append(h('div', { style: { marginTop: '8px' } }, toggle('Show corrections as I speak', cfg.corrections, (v) => { cfg.corrections = v; }, 'Turn off for a more realistic, uninterrupted session')));
        body.append(h('div', { style: { marginTop: '16px' } },
          btn('Start role-play', () => {
            if (sc.id === 'custom' && !cfg.custom.trim()) { toast('Describe the situation first'); return; }
            if (!getApiKey()) { api.close(); app.needKey(); return; }
            api.close();
            begin(sc, cfg);
          }, { cls: 'primary block', ico: 'play' })));
      },
    });
  }

  function begin(sc, cfg) {
    rp().lastCfg = { role: cfg.role, company: cfg.company, difficulty: cfg.difficulty, corrections: cfg.corrections };
    rp().active = { id: uid(), scenarioId: sc.id, cfg, messages: [], startedAt: Date.now() };
    reportId = null;
    store.save();
    starting = true;
    render();
    Promise.resolve(chat?.kickoff(ROLEPLAY_KICKOFF)).finally(() => { starting = false; });
  }

  /* ---------- session ---------- */
  function renderSession() {
    const a = rp().active;
    const sc = scenarioById(a.scenarioId);
    const partner = sc.id === 'custom' ? 'Partner' : sc.partner;
    const banner = h('div', { class: 'rp-banner' },
      h('span', { class: 'ic', style: { color: 'var(--accent-text)' }, html: I[sc.icon] || I.briefcase }),
      h('div', { class: 't' }, h('b', null, sc.title), h('span', null,
        (sc.id === 'custom' ? 'Custom' : `${sc.partner} · ${sc.partnerRole}`) + ' · ' + (DIFFICULTY[a.cfg.difficulty]?.label || ''))),
      btn('End', () => endSession(), { cls: 'sm primary', ico: 'flag' }));
    const chatEl = h('div', { class: 'chat' });
    el.append(banner, chatEl);
    chat = new Chat({
      el: chatEl,
      thread: () => rp().active,
      system: () => roleplaySystem(s(), sc, a.cfg),
      partner: () => partner,
      showCorrections: () => !!a.cfg.corrections,
      onChange: () => app.refreshBadges(),
      emptyState: () => (starting
        ? h('div', { class: 'empty' }, h('div', { class: 'spinner' }), h('p', null, 'Setting the scene…'))
        : h('div', { class: 'empty' }, h('p', null, `${partner} is ready when you are.`),
          h('button', { class: 'btn primary', type: 'button', onclick: () => chat?.kickoff(ROLEPLAY_KICKOFF) }, 'Start the scene'))),
    });
    chat.render();
  }

  async function endSession() {
    const a = rp().active;
    if (!a) return;
    const sc = scenarioById(a.scenarioId);
    const turns = a.messages.filter((m) => m.role === 'me' && !m.hidden).length;
    if (turns < 2) {
      const ok = await confirmSheet('End without feedback?', { ok: 'End session', danger: true, detail: 'Say at least two things to get a feedback report.' });
      if (!ok) return;
      rp().active = null; store.save(); render();
      return;
    }
    chat?.pause();
    chat?.abort?.abort();
    const overlay = h('div', { class: 'overlay-loading' }, h('div', null, h('div', { class: 'spinner' }), h('b', null, 'Preparing your feedback…'), h('p', { class: 'muted small' }, 'This takes about 10–20 seconds.')));
    el.append(overlay);
    const partner = sc.id === 'custom' ? 'PARTNER' : sc.partner.toUpperCase();
    const transcript = a.messages.filter((m) => !m.hidden && m.text)
      .map((m) => (m.role === 'me' ? 'LEARNER: ' : partner + ': ') + m.text).join('\n');
    try {
      const report = await callTool({
        model: reportModel(),
        system: reportSystem(s(), sc, a.cfg),
        messages: [{ role: 'user', content: 'Transcript:\n' + transcript }],
        tool: REPORT_TOOL,
        maxTokens: 1800,
      });
      const clean = cleanReport(report);
      const entry = { id: a.id, scenarioId: sc.id, title: sc.title, cfg: { role: a.cfg.role, company: a.cfg.company, difficulty: a.cfg.difficulty }, report: clean, date: Date.now(), turns, messages: a.messages.filter((m) => !m.hidden).slice(-60).map((m) => ({ role: m.role, text: m.text })) };
      rp().history.push(entry);
      rp().active = null;
      reportId = entry.id;
      store.save();
      render();
      app.refreshBadges();
    } catch (e) {
      overlay.remove();
      toast(e.message, { action: 'Retry', onAction: () => endSession(), ms: 6000 });
    }
  }

  function cleanReport(r) {
    const n = (v) => Math.max(1, Math.min(10, Math.round(Number(v) || 0))) || 1;
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      overall: n(r.overall),
      scores: Object.fromEntries(Object.keys(SCORE_LABELS).map((k) => [k, n(r.scores?.[k])])),
      summary: String(r.summary || ''),
      strengths: arr(r.strengths).map(String),
      improvements: arr(r.improvements).map(String),
      better_answers: arr(r.better_answers).filter((b) => b && b.stronger),
      phrases: arr(r.phrases).filter((p) => p && p.phrase),
    };
  }

  /* ---------- report ---------- */
  function renderReport(id) {
    const entry = rp().history.find((r) => r.id === id);
    if (!entry || !entry.report) { reportId = null; renderList(); return; }
    el.classList.add('scroll');
    const r = entry.report;
    const sc = scenarioById(entry.scenarioId);
    const wrap = h('div', { class: 'pad stack' });
    const r1 = ring(r.overall, 10, { label: `Overall score ${r.overall} out of 10` });
    r1.append(h('div', { class: 'val' }, h('div', null, String(r.overall), h('small', null, 'out of 10'))));
    wrap.append(h('div', { class: 'card' },
      h('div', { class: 'report-hero' }, r1,
        h('div', null, h('h2', null, entry.title), h('div', { class: 'muted small' }, relTime(entry.date) + ' · ' + entry.turns + ' answers'),
          h('p', { style: { margin: '8px 0 0' } }, r.summary)))));
    wrap.append(h('div', { class: 'card' }, h('h3', null, 'Scores'),
      Object.entries(SCORE_LABELS).map(([k, label]) => h('div', { class: 'meter' },
        h('div', { class: 'top' }, h('span', null, label), h('b', null, r.scores[k] + '/10')),
        h('div', { class: 'track', role: 'img', 'aria-label': `${label}: ${r.scores[k]} out of 10` }, h('div', { class: 'fill', style: { width: r.scores[k] * 10 + '%' } }))))));
    if (r.strengths.length) wrap.append(h('div', { class: 'card' }, h('h3', null, 'What went well'), h('ul', { class: 'bullets' }, r.strengths.map((x) => h('li', null, x)))));
    if (r.improvements.length) wrap.append(h('div', { class: 'card' }, h('h3', null, 'Work on next'), h('ul', { class: 'bullets' }, r.improvements.map((x) => h('li', null, x)))));
    if (r.better_answers.length) {
      wrap.append(h('div', { class: 'card' }, h('h3', null, 'Stronger ways to say it'),
        r.better_answers.map((b) => h('div', { class: 'better' },
          b.you_said ? h('div', { class: 'said' }, b.you_said) : null,
          h('div', { class: 'row' }, h('div', { class: 'strong grow' }, b.stronger),
            canSpeak ? h('button', { class: 'icon-btn', 'aria-label': 'Listen', onclick: () => { unlockAudio(); say(b.stronger); }, html: I.speaker }) : null),
          b.why ? h('div', { class: 'why' }, b.why) : null))));
    }
    if (r.phrases.length) {
      wrap.append(h('div', { class: 'card' }, h('h3', null, 'Useful phrases'),
        r.phrases.map((p) => {
          const saved = hasWord(p.phrase);
          const b = h('button', { class: 'btn sm soft', type: 'button', disabled: saved }, saved ? 'Saved' : 'Save');
          b.addEventListener('click', () => {
            addWord({ word: p.phrase, meaning: p.meaning, example: p.example, source: 'roleplay' });
            store.save(); b.textContent = 'Saved'; b.disabled = true; toast('Saved to your words');
          });
          return h('div', { class: 'phrase' }, h('div', { class: 'grow' }, h('b', null, p.phrase), h('span', null, p.meaning), p.example ? h('div', { class: 'muted small' }, '“' + p.example + '”') : null), b);
        })));
    }
    if (entry.messages?.length) {
      const tr = h('details', { class: 'card' }, h('summary', { style: { fontWeight: '600', cursor: 'pointer' } }, 'Transcript'),
        h('div', { style: { marginTop: '10px' } }, entry.messages.map((m) => h('p', { style: { margin: '6px 0' } },
          h('b', null, m.role === 'me' ? 'You: ' : (sc.id === 'custom' ? 'Partner: ' : sc.partner + ': ')), m.text))));
      wrap.append(tr);
    }
    wrap.append(h('div', { class: 'row' },
      btn('All scenarios', () => { reportId = null; render(); }, { cls: 'grow', ico: 'back' }),
      btn('Try again', () => { reportId = null; openSetup(sc); render(); }, { cls: 'primary grow', ico: 'refresh' })));
    el.append(wrap);
  }

  render();

  return {
    id: 'roleplay', el, title: 'Role-play',
    get chat() { return chat; },
    actions: () => (reportId && !rp().active ? [h('button', { class: 'icon-btn', 'aria-label': 'Back to scenarios', title: 'Back to scenarios', onclick: () => { reportId = null; render(); }, html: I.back })] : []),
    onShow() { if (chat) chat.scroll(true); },
    onHide() { chat?.pause(); },
    refresh() { render(); },
  };
}
