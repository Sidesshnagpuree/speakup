// Shared conversation UI used by Talk and Role-play.
import { h, iconBtn, toast, dots } from './ui.js';
import { I } from './icons.js';
import { store, uid, recordSentence, recordCheck, addMistakes, addWord, hasWord } from './store.js';
import { streamText, callTool } from './ai.js';
import { speaker, listener, canListen, canSpeak, unlockAudio, say, onSpeakingChange } from './speech.js';
import { correctionSystem, correctionUser, CORRECTION_TOOL, MISTAKE_TYPES } from './prompts.js';
import { markChanges, sameText } from './diff.js';

const HISTORY = 24;
let activeChat = null; // only one chat owns the mic/speaker at a time

export function buildHistory(messages) {
  const recent = messages.filter((m) => m.text && (m.role === 'me' || m.role === 'tutor')).slice(-HISTORY);
  const out = [];
  for (const m of recent) {
    const role = m.role === 'tutor' ? 'assistant' : 'user';
    const last = out[out.length - 1];
    if (last && last.role === role) last.content += '\n' + m.text;
    else out.push({ role, content: m.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (!out.length) out.push({ role: 'user', content: '(Start the conversation.)' });
  return out;
}

function normalizeFeedback(raw, original) {
  const mistakes = (Array.isArray(raw.mistakes) ? raw.mistakes : [])
    .filter((m) => m && (m.wrong || m.right) && String(m.wrong || '').trim().toLowerCase() !== String(m.right || '').trim().toLowerCase())
    .map((m) => ({
      wrong: String(m.wrong || '').trim(),
      right: String(m.right || '').trim(),
      type: MISTAKE_TYPES[m.type] ? m.type : 'other',
      explanation: String(m.explanation || '').trim(),
    }));
  const corrected = String(raw.corrected || original).trim();
  let natural = String(raw.natural || '').trim();
  if (natural && (sameText(natural, corrected) || sameText(natural, original))) natural = '';
  let useful = null;
  const w = raw.useful_word;
  if (w && w.word && w.meaning) useful = { word: String(w.word).trim(), meaning: String(w.meaning).trim(), example: String(w.example || '').trim() };
  return { mistakes, corrected, natural, useful };
}

export class Chat {
  /**
   * opts: el, thread() -> {messages}, system() -> string, partner() -> name,
   *       showCorrections() -> bool, emptyState() -> Node, onChange()
   */
  constructor(opts) {
    Object.assign(this, opts);
    this.busy = false;
    this.listening = false;
    this.abort = null;
    this.statusState = 'idle';
    this.build();
    this.offSpeak = onSpeakingChange((on) => {
      if (activeChat !== this) return;
      if (on && !this.busy && !this.listening) this.setStatus('speaking');
      if (!on && this.statusState === 'speaking') this.setStatus('idle');
      this.updateAction();
    });
  }

  build() {
    this.list = h('div', { class: 'messages', role: 'log', 'aria-live': 'polite' });
    this.statusText = h('div', { class: 'text' });
    this.hfBtn = h('button', {
      class: 'hf-btn', type: 'button', 'aria-pressed': String(!!store.state.settings.handsFree),
      title: 'Hands-free: the mic turns on automatically after each reply',
      onclick: () => this.toggleHandsFree(),
      html: I.headphones + '<span>Hands-free</span>',
    });
    if (!canListen) this.hfBtn.style.display = 'none';
    this.status = h('div', { class: 'status' }, this.statusText, this.hfBtn);
    this.input = h('textarea', {
      rows: 1, enterkeyhint: 'send', 'aria-label': 'Your message',
      placeholder: canListen ? 'Tap the mic to speak, or type…' : 'Type your message…',
    });
    this.input.addEventListener('input', () => { this.autosize(); this.updateAction(); });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(this.input.value); }
    });
    this.input.addEventListener('focus', () => document.body.classList.add('kb-open'));
    this.input.addEventListener('blur', () => setTimeout(() => document.body.classList.remove('kb-open'), 120));
    this.actionBtn = h('button', { class: 'mic-btn', type: 'button', onclick: () => this.onAction() });
    this.composer = h('div', { class: 'composer' }, this.status, h('div', { class: 'composer-row' }, this.input, this.actionBtn));
    this.el.replaceChildren(this.list, this.composer);
    this.setStatus('idle');
  }

  /* ---------- rendering ---------- */
  render() {
    const msgs = this.thread().messages.filter((m) => !m.hidden);
    this.list.replaceChildren();
    if (!msgs.length) {
      const empty = this.emptyState?.();
      if (empty) this.list.append(empty);
    } else {
      msgs.forEach((m) => this.list.append(this.nodeFor(m)));
    }
    this.scroll(true);
    this.updateAction();
  }

  clearEmpty() { this.list.querySelectorAll('.empty').forEach((n) => n.remove()); }

  nodeFor(m, { streaming = false } = {}) {
    if (m.role === 'tutor') {
      const bubble = h('div', { class: 'bubble' }, m.text);
      const tools = h('div', { class: 'msg-tools' },
        canSpeak ? iconBtn('speaker', 'Play again', () => { unlockAudio(); say(bubble.textContent); }) : null);
      return h('div', { class: 'msg tutor' + (streaming ? ' streaming' : ''), 'data-id': m.id },
        h('div', { class: 'who' }, this.partner()), bubble, tools);
    }
    return h('div', { class: 'msg me', 'data-id': m.id },
      h('div', { class: 'bubble' }, m.text),
      this.feedbackNode(m));
  }

  feedbackNode(m) {
    const fb = m.fb;
    if (!fb) return null;
    if (fb.state === 'pending') return h('div', { class: 'fb pending' }, dots(), 'Checking your English…');
    if (fb.state === 'error') {
      return h('div', { class: 'fb err' }, 'Couldn\'t check this sentence.',
        h('button', { type: 'button', onclick: () => this.check(m, m.prev || '') }, 'Retry'));
    }
    const speakBtn = (text) => canSpeak ? iconBtn('speaker', 'Listen', () => { unlockAudio(); say(text); }) : null;
    const naturalEl = fb.natural ? h('div', { class: 'fb-natural' },
      h('span', { class: 'lbl' }, 'Sounds more natural'),
      h('div', { class: 'fb-line' }, h('span', null, fb.natural), speakBtn(fb.natural))) : null;
    const wordEl = fb.useful ? this.usefulWordNode(fb.useful) : null;

    if (!fb.mistakes.length) {
      return h('div', { class: 'fb good' },
        h('div', { class: 'fb-head', html: I.checkCircle + '<span>Correct</span>' }),
        naturalEl, wordEl);
    }
    const marked = markChanges(m.text, fb.corrected);
    const corrected = h('span', { class: 'fb-corrected' },
      ...marked.flatMap((t, i) => [i ? ' ' : '', t.changed ? h('mark', null, t.w) : t.w]));
    const n = fb.mistakes.length;
    return h('div', { class: 'fb bad' },
      h('div', { class: 'fb-head', html: I.pencil + `<span>${n} ${n === 1 ? 'fix' : 'fixes'}</span>` }),
      h('div', { class: 'fb-line' }, corrected, speakBtn(fb.corrected)),
      h('ul', null, fb.mistakes.map((x) => h('li', null,
        h('span', { class: 'fix' }, x.wrong ? h('s', null, x.wrong) : null, x.wrong ? ' → ' : '', h('b', null, x.right || '(remove)')),
        h('span', { class: 'why' }, x.explanation)))),
      naturalEl, wordEl);
  }

  usefulWordNode(w) {
    const saved = hasWord(w.word);
    const b = h('button', { class: 'btn sm soft', type: 'button', disabled: saved },
      saved ? 'Saved' : '+ Save word');
    b.addEventListener('click', () => {
      addWord({ word: w.word, meaning: w.meaning, example: w.example, source: 'correction' });
      store.save();
      b.textContent = 'Saved'; b.disabled = true;
      toast(`“${w.word}” saved to your words`);
      this.onChange?.();
    });
    return h('div', { class: 'fb-word' },
      h('span', { class: 'lbl' }, 'Word to try'),
      h('div', null, h('b', null, w.word), ' — ', w.meaning),
      w.example ? h('div', { class: 'muted small' }, '“' + w.example + '”') : null, b);
  }

  updateMsg(m) {
    const old = this.list.querySelector(`[data-id="${m.id}"]`);
    if (!old) return;
    const nearBottom = this.isNearBottom();
    old.replaceWith(this.nodeFor(m));
    if (nearBottom) this.scroll(true);
  }

  isNearBottom() { const l = this.list; return l.scrollHeight - l.scrollTop - l.clientHeight < 160; }
  scroll(force = false) {
    if (force || this.isNearBottom()) requestAnimationFrame(() => { this.list.scrollTop = this.list.scrollHeight; });
  }
  autosize() {
    const t = this.input;
    t.style.height = 'auto';
    t.style.height = Math.min(t.scrollHeight + 2, 128) + 'px';
  }

  /* ---------- status + main button ---------- */
  setStatus(state, note = '') {
    this.statusState = state;
    this.status.className = 'status ' + state;
    const who = this.partner();
    const map = {
      idle: note || (store.state.settings.handsFree && canListen ? 'Hands-free is on — tap the mic to start' : ''),
      listening: 'Listening… tap ■ when you finish',
      thinking: `${who} is thinking…`,
      speaking: `${who} is speaking — tap the mic to interrupt`,
    };
    const text = map[state] ?? '';
    this.statusText.replaceChildren(...[
      state === 'listening' ? h('i', { class: 'live-dot' }) : null,
      state === 'thinking' ? dots() : null,
      h('span', null, text)].filter(Boolean));
    this.updateAction();
  }

  updateAction() {
    const b = this.actionBtn;
    const hasText = !!this.input.value.trim();
    b.classList.toggle('listening', this.listening);
    b.disabled = false;
    if (this.listening) { b.innerHTML = I.stop; b.setAttribute('aria-label', 'Stop listening'); }
    else if (this.busy) { b.innerHTML = I.stop; b.setAttribute('aria-label', 'Stop reply'); }
    else if (hasText || !canListen) { b.innerHTML = I.send; b.setAttribute('aria-label', 'Send'); b.disabled = !hasText; }
    else { b.innerHTML = I.mic; b.setAttribute('aria-label', 'Speak'); }
  }

  onAction() {
    unlockAudio();
    this.claim();
    if (this.listening) { listener.stop(); return; }
    if (this.busy) { this.abort?.abort(); return; }
    if (this.input.value.trim()) { this.send(this.input.value); return; }
    this.startListening();
  }

  claim() {
    if (activeChat && activeChat !== this) activeChat.pause();
    activeChat = this;
  }

  toggleHandsFree() {
    const s = store.state.settings;
    s.handsFree = !s.handsFree;
    store.save();
    this.hfBtn.setAttribute('aria-pressed', String(s.handsFree));
    unlockAudio();
    this.claim();
    if (s.handsFree) {
      toast('Hands-free on: the mic opens by itself after each reply');
      if (!this.busy && !this.listening && !speaker.active) this.startListening();
    } else {
      toast('Hands-free off');
      if (this.statusState === 'idle') this.setStatus('idle');
    }
  }

  /** Stop mic + voice (tab switch, app hidden). */
  pause() {
    if (this.listening) { listener.cancel(); this.listening = false; }
    speaker.stop();
    if (!this.busy) this.setStatus('idle'); else this.updateAction();
  }

  isVisible() { return !document.hidden && this.el.offsetParent !== null; }

  /* ---------- voice input ---------- */
  startListening() {
    if (!canListen || this.busy || this.listening) return;
    this.claim();
    speaker.stop();
    const base = this.input.value.trim();
    this.listening = true;
    this.setStatus('listening');
    const ok = listener.start({
      onText: (t) => { this.input.value = (base ? base + ' ' : '') + t; this.autosize(); },
      onEnd: ({ text, error, cancelled }) => {
        this.listening = false;
        if (cancelled) { this.setStatus('idle'); return; }
        if (error === 'not-allowed' || error === 'service-not-allowed') {
          store.state.settings.handsFree = false; store.save();
          this.hfBtn.setAttribute('aria-pressed', 'false');
          this.setStatus('idle', 'Microphone blocked — allow mic access for this site, then try again.');
          return;
        }
        const full = this.input.value.trim();
        if (text && full) {
          if (store.state.settings.autoSend) this.send(full);
          else { this.setStatus('idle', 'Check the text, then tap send'); this.input.focus(); }
          return;
        }
        let note = '';
        if (error === 'no-speech' || (!error && !text)) note = "Didn't catch that — tap the mic and try again.";
        else if (error === 'network') note = 'Speech recognition needs an internet connection.';
        else if (error === 'audio-capture') note = 'No microphone found.';
        else if (error === 'start-failed') note = "Couldn't start the microphone — tap the mic to try again.";
        else if (error) note = 'Voice input stopped (' + error + '). Tap the mic to try again.';
        this.setStatus('idle', note);
      },
    });
    if (!ok) { this.listening = false; this.setStatus('idle', "Couldn't start the microphone."); }
  }

  /* ---------- sending ---------- */
  async send(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!text || this.busy) return;
    this.claim();
    unlockAudio();
    speaker.stop();
    if (this.listening) { listener.cancel(); this.listening = false; }
    this.input.value = '';
    this.autosize();
    const th = this.thread();
    const prev = [...th.messages].reverse().find((m) => m.role === 'tutor' && m.text)?.text || '';
    const m = { id: uid(), role: 'me', text, ts: Date.now(), prev };
    if (this.showCorrections()) m.fb = { state: 'pending' };
    th.messages.push(m);
    recordSentence(text);
    store.save();
    this.clearEmpty();
    this.list.append(this.nodeFor(m));
    this.scroll(true);
    this.onChange?.();
    if (m.fb) this.check(m, prev);
    await this.reply();
  }

  /** Send an instruction the learner doesn't see (e.g. "start the conversation"). */
  async kickoff(instruction) {
    if (this.busy) return;
    this.claim();
    unlockAudio();
    const th = this.thread();
    th.messages.push({ id: uid(), role: 'me', hidden: true, text: instruction, ts: Date.now() });
    store.save();
    await this.reply();
  }

  async check(m, prev) {
    m.fb = { state: 'pending' };
    this.updateMsg(m);
    try {
      const raw = await callTool({
        system: correctionSystem(store.state.settings),
        messages: [{ role: 'user', content: correctionUser(prev, m.text) }],
        tool: CORRECTION_TOOL,
        maxTokens: 700,
      });
      const fb = normalizeFeedback(raw, m.text);
      m.fb = { state: 'done', ...fb };
      recordCheck(fb);
      addMistakes(fb, m.text);
    } catch (e) {
      m.fb = { state: 'error', msg: e.message };
    }
    store.save();
    this.updateMsg(m);
    this.onChange?.();
  }

  async reply() {
    const th = this.thread();
    this.busy = true;
    this.setStatus('thinking');
    const t = { id: uid(), role: 'tutor', text: '', ts: Date.now() };
    const node = this.nodeFor(t, { streaming: true });
    this.clearEmpty();
    this.list.append(node);
    this.scroll(true);
    const bubble = node.querySelector('.bubble');
    const voice = store.state.settings.autoSpeak && canSpeak;
    if (voice) speaker.begin();
    const ctrl = new AbortController();
    this.abort = ctrl;
    let first = true;
    try {
      const text = await streamText({
        system: this.system(),
        messages: buildHistory(th.messages),
        maxTokens: 400,
        signal: ctrl.signal,
        onText: (full, delta) => {
          if (first) { first = false; this.setStatus(voice ? 'speaking' : 'thinking'); }
          bubble.textContent = full;
          if (voice) speaker.push(delta);
          this.scroll();
        },
      });
      t.text = text.trim() || '…';
      th.messages.push(t);
      store.save();
      node.classList.remove('streaming');
      bubble.textContent = t.text;
      this.busy = false;
      this.abort = null;
      this.onChange?.();
      if (voice) {
        speaker.onIdle = () => this.afterReply();
        speaker.end();
        this.setStatus('speaking');
      } else {
        this.setStatus('idle');
        this.afterReply();
      }
    } catch (e) {
      this.busy = false;
      this.abort = null;
      speaker.stop();
      if (e.name === 'AbortError') {
        const partial = bubble.textContent.trim();
        if (partial) {
          t.text = partial; th.messages.push(t); store.save();
          node.classList.remove('streaming');
        } else node.remove();
        this.setStatus('idle');
        return;
      }
      node.remove();
      this.showError(e.message, () => this.reply());
      this.setStatus('idle');
    }
  }

  afterReply() {
    if (activeChat !== this) return;
    this.setStatus('idle');
    if (store.state.settings.handsFree && canListen && this.isVisible()) {
      setTimeout(() => { if (!this.busy && !this.listening && !speaker.active && this.isVisible()) this.startListening(); }, 300);
    }
  }

  showError(message, retry) {
    const node = h('div', { class: 'msg error', role: 'alert' },
      h('div', null, message),
      retry ? h('button', { class: 'btn sm', type: 'button', onclick: () => { node.remove(); retry(); } }, 'Try again') : null);
    this.list.append(node);
    this.scroll(true);
  }
}
