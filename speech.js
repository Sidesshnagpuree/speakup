// Speech recognition (your voice → text) and speech synthesis (tutor's voice).
import { store } from './store.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance !== 'undefined';

let voices = [];
function loadVoices() { try { voices = canSpeak ? window.speechSynthesis.getVoices() : []; } catch (e) { voices = []; } }
if (canSpeak) {
  loadVoices();
  try { window.speechSynthesis.addEventListener('voiceschanged', loadVoices); } catch (e) { window.speechSynthesis.onvoiceschanged = loadVoices; }
}

const normLang = (l) => (l || '').replace('_', '-').toLowerCase();
export function englishVoices() {
  loadVoices();
  return voices.filter((v) => normLang(v.lang).startsWith('en'));
}
const QUALITY = /(google|natural|neural|premium|enhanced|siri)/i;
export function pickVoice() {
  if (!voices.length) loadVoices();
  const s = store.state.settings;
  if (s.voiceURI) {
    const v = voices.find((x) => x.voiceURI === s.voiceURI);
    if (v) return v;
  }
  const want = normLang(s.accent);
  let pool = voices.filter((v) => normLang(v.lang) === want);
  if (!pool.length) pool = voices.filter((v) => normLang(v.lang).startsWith('en'));
  const score = (v) => (QUALITY.test(v.name) ? 2 : 0) + (v.default ? 0.5 : 0);
  return pool.slice().sort((a, b) => score(b) - score(a))[0] || null;
}

let unlocked = false;
/** Mobile browsers only allow speech after a user gesture — call this from taps. */
export function unlockAudio() {
  if (!canSpeak || unlocked) return;
  unlocked = true;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

const clean = (t) => t
  .replace(/\*\*|__|[*_#`~>]/g, '')
  .replace(/\p{Extended_Pictographic}/gu, '')
  .replace(/\s+/g, ' ')
  .trim();

const ABBR = /\b(mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|approx|no)\.$/i;
function nextSentence(buf) {
  const re = /[.!?…]+["'”’)\]]*(\s+)/g;
  let m;
  while ((m = re.exec(buf))) {
    const end = m.index + m[0].length;
    const sentence = buf.slice(0, m.index + m[0].length - m[1].length);
    if (ABBR.test(sentence.trim())) continue;
    if (sentence.trim().length < 3) continue;
    return { sentence, end };
  }
  return null;
}

const listeners = new Set();
export function onSpeakingChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
const emit = (v) => listeners.forEach((fn) => { try { fn(v); } catch (e) { /* ignore */ } });

/** Speaks streamed text sentence-by-sentence, so the tutor starts talking before the reply is finished. */
export class Speaker {
  constructor() { this.active = false; this.buf = ''; this.timer = null; this.onIdle = null; this.gen = 0; }
  begin() {
    this.stop();
    this.gen++;
    this.active = true;
    this.buf = '';
    this.ended = false;
  }
  push(delta) {
    if (!this.active) return;
    this.buf += delta;
    let m;
    while ((m = nextSentence(this.buf))) {
      this._say(m.sentence);
      this.buf = this.buf.slice(m.end);
    }
  }
  end() {
    if (!this.active) return;
    const rest = this.buf;
    this.buf = '';
    if (rest.trim()) this._say(rest);
    this.ended = true;
    this._watch();
  }
  _say(t) {
    const text = clean(t);
    if (!text || !canSpeak) return;
    const s = store.state.settings;
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = s.accent;
    u.rate = Number(s.rate) || 1;
    try { window.speechSynthesis.speak(u); emit(true); } catch (e) { /* ignore */ }
  }
  _watch() {
    clearInterval(this.timer);
    const gen = this.gen;
    let idle = 0;
    let waited = 0;
    this.timer = setInterval(() => {
      waited += 250;
      const ss = window.speechSynthesis;
      const busy = canSpeak && (ss.speaking || ss.pending);
      if (!busy) idle++; else idle = 0;
      // idle for 0.5s, or a hard cap in case the browser never reports "done"
      if (idle >= 2 || waited > 90000) {
        clearInterval(this.timer);
        this.timer = null;
        if (gen !== this.gen || !this.active) return;
        this.active = false;
        emit(false);
        const cb = this.onIdle; this.onIdle = null;
        cb?.();
      }
    }, 250);
  }
  stop() {
    clearInterval(this.timer);
    this.timer = null;
    const was = this.active;
    this.active = false;
    this.onIdle = null;
    this.gen++;
    // Only cancel when something is queued: on some Android builds a cancel() right
    // before speak() swallows the next utterance.
    if (canSpeak) {
      try {
        const ss = window.speechSynthesis;
        if (ss.speaking || ss.pending) ss.cancel();
      } catch (e) { /* ignore */ }
    }
    if (was) emit(false);
  }
}

export const speaker = new Speaker();

/** One-off: read a piece of text aloud (replay buttons). */
export function say(text, onDone) {
  if (!canSpeak) return false;
  unlockAudio();
  speaker.begin();
  speaker.onIdle = onDone || null;
  speaker.push(text + ' ');
  speaker.end();
  return true;
}
export const stopSpeaking = () => speaker.stop();
export const isSpeaking = () => speaker.active;

/** Wraps the Web Speech API recogniser. */
export class Listener {
  constructor() { this.rec = null; }
  get active() { return !!this.rec; }
  start({ onText, onEnd, lang }) {
    if (!SR) return false;
    this.cancel();
    const rec = new SR();
    this.rec = rec;
    rec.lang = lang || store.state.settings.sttLang || 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    let finalText = '';
    let interim = '';
    let error = null;
    rec.onresult = (e) => {
      let f = '', i = '';
      for (let k = 0; k < e.results.length; k++) {
        const r = e.results[k];
        if (r.isFinal) f += r[0].transcript; else i += r[0].transcript;
      }
      finalText = f; interim = i;
      onText?.((f + ' ' + i).replace(/\s+/g, ' ').trim());
    };
    rec.onerror = (e) => { error = e.error || 'error'; };
    rec.onend = () => {
      if (this.rec === rec) this.rec = null;
      const text = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
      onEnd?.({ text, error, cancelled: !!rec._cancelled });
    };
    try {
      rec.start();
      return true;
    } catch (e) {
      // Usually "already started" while a previous session is still shutting down — retry once.
      setTimeout(() => {
        if (this.rec !== rec) return;
        try { rec.start(); } catch (e2) {
          this.rec = null;
          onEnd?.({ text: '', error: 'start-failed', cancelled: false });
        }
      }, 350);
      return true;
    }
  }
  /** Stop and keep what was heard. */
  stop() { if (this.rec) { try { this.rec.stop(); } catch (e) { /* ignore */ } } }
  /** Stop and throw away. */
  cancel() {
    const r = this.rec;
    if (r) { r._cancelled = true; this.rec = null; try { r.abort(); } catch (e) { /* ignore */ } }
  }
}

export const listener = new Listener();
