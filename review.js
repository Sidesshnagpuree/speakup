import { h, iconBtn, btn, openSheet, toast, seg, dots, relTime, confirmSheet } from './ui.js';
import { I } from './icons.js';
import { store, todayKey, dueMistakes, addWord, hasWord, getApiKey } from './store.js';
import { callTool } from './ai.js';
import { typeLabel, WORD_TOOL, wordSystem, wordUser } from './prompts.js';
import { canSpeak, canListen, say, unlockAudio, listener, speaker } from './speech.js';
import { markChanges, similarity } from './diff.js';

const DAY = 86400000;
const INTERVALS = [5 * 60000, DAY, 3 * DAY, 7 * DAY];

function highlight(sentence, wrong) {
  if (!wrong) return [sentence];
  const i = sentence.toLowerCase().indexOf(wrong.toLowerCase());
  if (i < 0) return [sentence];
  return [sentence.slice(0, i), h('mark', { class: 'bad' }, sentence.slice(i, i + wrong.length)), sentence.slice(i + wrong.length)];
}
const speakBtn = (text) => (canSpeak ? iconBtn('speaker', 'Listen', () => { unlockAudio(); say(text); }) : null);

export function createReview(app) {
  const el = h('section', { class: 'view scroll', id: 'view-review', 'aria-label': 'Review' });
  let tab = 'mistakes';
  let wotdLoading = false;
  let wotdError = '';

  function render() {
    const st = store.state;
    const top = el.scrollTop;
    el.replaceChildren();
    const wrap = h('div', { class: 'pad' });
    wrap.append(seg([['mistakes', `Mistakes (${st.mistakes.filter((m) => !m.mastered).length})`], ['words', `My words (${st.vocab.length})`]], tab, (v) => { tab = v; render(); }));
    const body = h('div', { style: { marginTop: '14px' } });
    wrap.append(body);
    el.append(wrap);
    if (tab === 'mistakes') renderMistakes(body); else renderWords(body);
    el.scrollTop = top;
  }

  /* ---------- mistakes ---------- */
  function renderMistakes(body) {
    const all = store.state.mistakes;
    const due = dueMistakes();
    const mastered = all.filter((m) => m.mastered).length;
    body.append(h('div', { class: 'card practice-card' },
      h('div', { class: 'num' }, String(due.length)),
      h('div', { class: 'grow', style: { flex: 1 } }, h('b', null, due.length === 1 ? 'mistake to practise' : 'mistakes to practise'),
        h('div', { class: 'muted small' }, `${mastered} mastered · cards come back after 1, 3 and 7 days`)),
      btn('Practise', () => practise(), { cls: 'primary', attrs: { disabled: !due.length } })));

    if (!all.length) {
      body.append(h('div', { class: 'empty', style: { marginTop: '24px' } },
        h('div', { class: 'art', html: I.book }),
        h('h2', null, 'No mistakes yet'),
        h('p', null, 'As you talk, every correction is saved here so you can practise it later.')));
      return;
    }
    const list = h('div', { class: 'list', style: { marginTop: '14px' } });
    all.slice().reverse().slice(0, 200).forEach((m) => {
      list.append(h('div', { class: 'item' + (m.mastered ? ' done' : '') },
        h('div', { class: 'top' },
          h('div', { class: 'grow' },
            h('div', { class: 'fix' }, h('s', null, m.wrong || '—'), ' → ', h('b', null, m.right || '(remove)')),
            m.explanation ? h('div', { class: 'why' }, m.explanation) : null),
          speakBtn(m.corrected || m.right),
          iconBtn('trash', 'Delete', () => { store.state.mistakes = store.state.mistakes.filter((x) => x.id !== m.id); store.save(); render(); app.refreshBadges(); })),
        h('div', { class: 'meta' },
          h('span', { class: 'tag' }, typeLabel(m.type)),
          m.mastered ? h('span', { class: 'tag good' }, 'Mastered') : null,
          (m.count || 1) > 1 ? h('span', { class: 'tag bad' }, `×${m.count}`) : null,
          h('span', { class: 'muted small' }, relTime(m.ts)))));
    });
    body.append(list);
  }

  function practise() {
    const queue = dueMistakes().slice(0, 10);
    if (!queue.length) return;
    let i = 0;
    let revealed = false;
    let reviewed = 0;
    openSheet({
      title: 'Practise',
      onClose: () => { listener.cancel(); speaker.stop(); store.save(); render(); app.refreshBadges(); },
      content: (body, api) => {
        const card = () => {
          const m = queue[i];
          body.replaceChildren();
          if (!m) {
            body.append(h('div', { class: 'empty' },
              h('div', { class: 'art', html: I.check }),
              h('h2', null, 'Nice work!'),
              h('p', null, `You reviewed ${reviewed} ${reviewed === 1 ? 'card' : 'cards'}. Keep talking to collect more.`),
              btn('Done', () => api.close(), { cls: 'primary' })));
            return;
          }
          const f = h('div', { class: 'flash' });
          f.append(h('div', { class: 'progress' }, `Card ${i + 1} of ${queue.length} · ${typeLabel(m.type)}`));
          f.append(h('div', { class: 'muted small' }, 'How would you fix this?'));
          f.append(h('div', { class: 'sent' }, ...highlight(m.sentence || m.wrong, m.wrong)));
          if (!revealed) {
            f.append(btn('Show answer', () => { revealed = true; card(); }, { cls: 'primary block', ico: 'eye' }));
          } else {
            const target = m.corrected || m.right;
            const marked = markChanges(m.sentence || '', target);
            f.append(h('div', { class: 'answer' },
              h('div', { class: 'row' }, h('div', { class: 'c grow' }, ...marked.flatMap((t, k) => [k ? ' ' : '', t.changed ? h('mark', null, t.w) : t.w])), speakBtn(target)),
              h('div', { class: 'w' }, h('b', null, m.wrong + ' → ' + m.right), m.explanation ? ' — ' + m.explanation : '')));
            const saidEl = h('div', { class: 'said' });
            if (canListen) {
              const sayBtn = btn('Say the correct sentence', () => {
                unlockAudio();
                speaker.stop();
                if (listener.active) { listener.stop(); return; }
                sayBtn.lastChild.textContent = 'Listening… tap to stop';
                listener.start({
                  onText: (t) => { saidEl.textContent = 'You said: ' + t; },
                  onEnd: ({ text }) => {
                    sayBtn.lastChild.textContent = 'Say it again';
                    if (!text) { saidEl.textContent = "Didn't catch that — try again."; return; }
                    const score = similarity(text, target);
                    saidEl.replaceChildren('You said: “' + text + '” — ',
                      h('span', { class: 'match', style: { color: score >= 85 ? 'var(--good)' : 'var(--bad)' } }, score + '% match'),
                      score >= 85 ? ' Great!' : ' Listen and try once more.');
                  },
                });
              }, { cls: 'soft block', ico: 'mic' });
              f.append(sayBtn, saidEl);
            }
            f.append(h('div', { class: 'row', style: { marginTop: '14px' } },
              btn('Again', () => grade(false), { cls: 'grow' }),
              btn('Got it', () => grade(true), { cls: 'primary grow', ico: 'check' })));
          }
          body.append(f);
        };
        const grade = (ok) => {
          const m = queue[i];
          listener.cancel();
          if (ok) {
            m.box = Math.min((m.box || 0) + 1, 3);
            m.due = Date.now() + INTERVALS[m.box];
            if (m.box >= 3) m.mastered = true;
          } else {
            m.box = 0;
            m.due = Date.now() + INTERVALS[0];
          }
          reviewed++;
          i++;
          revealed = false;
          store.save();
          card();
        };
        card();
      },
    });
  }

  /* ---------- words ---------- */
  async function loadWotd() {
    if (wotdLoading || !getApiKey()) return;
    wotdLoading = true; wotdError = '';
    render();
    try {
      const known = store.state.vocab.slice(-60).map((v) => v.word);
      if (store.state.wotd?.data?.word) known.push(store.state.wotd.data.word);
      const data = await callTool({
        system: wordSystem(store.state.settings, known),
        messages: [{ role: 'user', content: wordUser(todayKey()) }],
        tool: WORD_TOOL,
        maxTokens: 500,
      });
      if (!data.word) throw new Error('No word returned');
      store.state.wotd = { date: todayKey(), data };
      store.save();
    } catch (e) {
      wotdError = e.message;
    }
    wotdLoading = false;
    if (tab === 'words') render();
  }

  function wotdCard() {
    const w = store.state.wotd;
    const fresh = w && w.date === todayKey() && w.data?.word;
    const head = h('div', { class: 'wotd-head' }, h('span', { class: 'tag accent' }, 'Word of the day'), h('span', { class: 'grow' }));
    if (!fresh) {
      if (wotdLoading) return h('div', { class: 'card wotd' }, head, h('div', { class: 'row muted', style: { marginTop: '12px' } }, dots(), 'Picking today\'s word…'));
      return h('div', { class: 'card wotd' }, head,
        h('p', { class: 'muted' }, wotdError || (getApiKey() ? 'Get a new useful word every day.' : 'Add your API key in Settings to get a daily word.')),
        getApiKey() ? btn(wotdError ? 'Try again' : 'Get today\'s word', () => loadWotd(), { cls: 'soft', ico: 'sparkles' }) : null);
    }
    const d = w.data;
    const saved = hasWord(d.word);
    const saveBtn = btn(saved ? 'Saved' : 'Save to my words', () => {
      addWord({ word: d.word, meaning: d.meaning, example: (d.examples || [])[0] || d.work_example || '', source: 'wotd' });
      store.save(); render(); toast('Saved');
    }, { cls: 'soft sm', attrs: { disabled: saved } });
    return h('div', { class: 'card wotd' }, head,
      h('div', { class: 'row' },
        h('div', { class: 'grow' },
          h('div', { class: 'word-big' }, d.word),
          h('div', { class: 'pron' }, [d.part_of_speech, d.pronunciation].filter(Boolean).join(' · '))),
        speakBtn(d.word)),
      h('p', { style: { margin: '8px 0 4px' } }, d.meaning),
      h('ul', { class: 'ex' }, (d.examples || []).map((x) => h('li', null, x)),
        d.work_example ? h('li', null, h('b', null, 'At work: '), d.work_example) : null),
      (d.synonyms || []).length ? h('p', { class: 'muted small', style: { margin: '8px 0 0' } }, 'Similar: ' + d.synonyms.join(', ')) : null,
      h('div', { style: { marginTop: '12px' } }, saveBtn));
  }

  function renderWords(body) {
    body.append(wotdCard());
    const w = store.state.wotd;
    if (!(w && w.date === todayKey()) && !wotdLoading && !wotdError && getApiKey()) setTimeout(loadWotd, 0);

    // add a word
    const wordIn = h('input', { class: 'input', placeholder: 'Word or phrase', 'aria-label': 'Word or phrase' });
    const meanIn = h('input', { class: 'input', placeholder: 'Meaning (optional)', 'aria-label': 'Meaning' });
    const add = () => {
      if (!wordIn.value.trim()) { wordIn.focus(); return; }
      if (!addWord({ word: wordIn.value, meaning: meanIn.value.trim() })) { toast('Already in your words'); return; }
      store.save(); render();
    };
    body.append(h('div', { class: 'section-title' }, 'Add a word'),
      h('div', { class: 'card stack' }, wordIn, meanIn, btn('Add', add, { cls: 'block', ico: 'plus' })));

    const vocab = store.state.vocab;
    body.append(h('div', { class: 'section-title' }, `My words (${vocab.length})`));
    if (!vocab.length) {
      body.append(h('p', { class: 'muted', style: { padding: '0 4px' } }, 'Save words from the word of the day, from corrections and from role-play reports.'));
      return;
    }
    const list = h('div', { class: 'list' });
    vocab.slice().sort((a, b) => (a.mastered - b.mastered) || (b.ts - a.ts)).forEach((v) => {
      const learned = h('button', {
        class: 'icon-btn', 'aria-label': v.mastered ? 'Mark as not learned' : 'Mark as learned', title: v.mastered ? 'Learned' : 'Mark as learned',
        style: { color: v.mastered ? 'var(--good)' : 'var(--muted)' }, html: I.checkCircle,
        onclick: () => { v.mastered = !v.mastered; store.save(); render(); },
      });
      list.append(h('div', { class: 'item' + (v.mastered ? ' done' : '') },
        h('div', { class: 'top' },
          h('div', { class: 'grow' },
            h('div', { class: 'word' }, v.word),
            v.meaning ? h('div', { class: 'why' }, v.meaning) : null,
            v.example ? h('div', { class: 'why', style: { fontStyle: 'italic' } }, '“' + v.example + '”') : null),
          speakBtn(v.example ? v.word + '. ' + v.example : v.word),
          learned,
          iconBtn('trash', 'Delete', async () => {
            if (!(await confirmSheet(`Delete “${v.word}”?`, { ok: 'Delete', danger: true }))) return;
            store.state.vocab = store.state.vocab.filter((x) => x.id !== v.id); store.save(); render();
          }))));
    });
    body.append(list);
  }

  render();
  return {
    id: 'review', el, title: 'Review',
    actions: () => [],
    onShow() { render(); },
    onHide() { listener.cancel(); },
    refresh() { render(); },
  };
}
