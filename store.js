// All app data lives in this phone's browser storage (localStorage).
const KEY = 'speakup.v1';
const KEY_API = 'speakup.apikey';

export const DEFAULT_SETTINGS = {
  name: '',
  about: '',
  level: 'intermediate',     // beginner | intermediate | advanced
  sttLang: 'en-IN',          // accent the recogniser listens for
  accent: 'en-US',           // tutor voice + spelling
  voiceURI: '',
  rate: 1,
  autoSpeak: true,
  autoSend: true,
  handsFree: false,
  corrections: true,
  correctionStyle: 'natural', // errors | natural
  tutorName: 'Maya',
  dailyGoal: 20,
  model: 'fast',             // fast | smart
  modelOverride: '',
  smartReports: true,
  theme: 'system',
  onboarded: false,
};

function fresh() {
  return {
    v: 1,
    settings: { ...DEFAULT_SETTINGS },
    talk: { topic: 'free', messages: [] },
    rp: { active: null, history: [] },
    mistakes: [],
    vocab: [],
    wotd: null,
    stats: { days: {}, types: {}, usage: {} },
  };
}

function load() {
  const base = fresh();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const s = JSON.parse(raw);
    return {
      ...base, ...s,
      settings: { ...base.settings, ...(s.settings || {}) },
      talk: { ...base.talk, ...(s.talk || {}) },
      rp: { ...base.rp, ...(s.rp || {}) },
      stats: { ...base.stats, ...(s.stats || {}) },
    };
  } catch (e) {
    return base;
  }
}

export const store = {
  state: load(),
  save() {
    const st = this.state;
    // keep storage bounded
    if (st.talk.messages.length > 160) st.talk.messages = st.talk.messages.slice(-160);
    if (st.rp.history.length > 40) st.rp.history = st.rp.history.slice(-40);
    if (st.mistakes.length > 600) st.mistakes = st.mistakes.slice(-600);
    if (st.vocab.length > 1000) st.vocab = st.vocab.slice(-1000);
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
      return true;
    } catch (e) {
      // Quota: drop old transcripts and retry once.
      try {
        st.talk.messages = st.talk.messages.slice(-60);
        st.rp.history.forEach((r) => { r.messages = (r.messages || []).slice(-20); });
        localStorage.setItem(KEY, JSON.stringify(st));
        return true;
      } catch (e2) {
        return false;
      }
    }
  },
  replace(data) {
    const base = fresh();
    this.state = {
      ...base, ...data,
      settings: { ...base.settings, ...(data.settings || {}) },
      talk: { ...base.talk, ...(data.talk || {}) },
      rp: { ...base.rp, ...(data.rp || {}) },
      stats: { ...base.stats, ...(data.stats || {}) },
    };
    this.save();
  },
  reset() {
    this.state = fresh();
    try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  },
};

export function getApiKey() {
  try { return localStorage.getItem(KEY_API) || ''; } catch (e) { return ''; }
}
export function setApiKey(k) {
  try {
    if (k) localStorage.setItem(KEY_API, k.trim());
    else localStorage.removeItem(KEY_API);
  } catch (e) { /* ignore */ }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const todayKey = (d = new Date()) => d.toLocaleDateString('en-CA'); // YYYY-MM-DD, local time
export const countWords = (t) => (t.trim().match(/\S+/g) || []).length;

/* ---------- Stats ---------- */
export function dayStats(key = todayKey()) {
  const days = store.state.stats.days;
  return (days[key] ||= { msgs: 0, words: 0, checked: 0, correct: 0, mistakes: 0 });
}

export function recordSentence(text) {
  const d = dayStats();
  d.msgs += 1;
  d.words += countWords(text);
}

export function recordCheck(fb) {
  const d = dayStats();
  d.checked += 1;
  if (!fb.mistakes.length) d.correct += 1;
  d.mistakes += fb.mistakes.length;
  const types = store.state.stats.types;
  for (const m of fb.mistakes) types[m.type] = (types[m.type] || 0) + 1;
}

export function streakInfo() {
  const days = store.state.stats.days;
  const active = (k) => days[k] && days[k].msgs > 0;
  const d = new Date();
  let current = 0;
  if (!active(todayKey(d))) d.setDate(d.getDate() - 1); // today not done yet: streak still alive from yesterday
  while (active(todayKey(d))) { current++; d.setDate(d.getDate() - 1); }
  // best streak
  const keys = Object.keys(days).filter(active).sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) {
    if (prev) {
      const p = new Date(prev + 'T12:00:00'); p.setDate(p.getDate() + 1);
      run = todayKey(p) === k ? run + 1 : 1;
    } else run = 1;
    best = Math.max(best, run);
    prev = k;
  }
  return { current, best: Math.max(best, current), totalDays: keys.length, doneToday: active(todayKey()) };
}

/* ---------- API usage & cost estimate ---------- */
const PRICES = [ // USD per million tokens [input, output]
  [/haiku/i, 1, 5],
  [/sonnet/i, 2, 10],
  [/opus/i, 5, 25],
  [/fable/i, 10, 50],
];
export function priceFor(model) {
  const p = PRICES.find(([re]) => re.test(model));
  return p ? { in: p[1], out: p[2] } : { in: 2, out: 10 };
}
export function recordUsage(model, usage) {
  if (!usage) return;
  const u = store.state.stats.usage;
  const day = (u[todayKey()] ||= {});
  const m = (day[model] ||= { in: 0, out: 0, calls: 0 });
  m.in += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  m.out += usage.output_tokens || 0;
  m.calls += 1;
}
export function usageSummary() {
  const u = store.state.stats.usage;
  const today = todayKey();
  const sum = (filter) => {
    let cost = 0, tin = 0, tout = 0, calls = 0;
    for (const [day, models] of Object.entries(u)) {
      if (!filter(day)) continue;
      for (const [model, m] of Object.entries(models)) {
        const p = priceFor(model);
        cost += (m.in * p.in + m.out * p.out) / 1e6;
        tin += m.in; tout += m.out; calls += m.calls;
      }
    }
    return { cost, tin, tout, calls };
  };
  const monthPrefix = today.slice(0, 7);
  return { today: sum((d) => d === today), month: sum((d) => d.startsWith(monthPrefix)), all: sum(() => true) };
}

/* ---------- Mistakes & vocabulary ---------- */
const norm = (s) => (s || '').toLowerCase().replace(/[^\p{L}\p{N}' ]/gu, '').replace(/\s+/g, ' ').trim();

export function addMistakes(fb, sentence) {
  const list = store.state.mistakes;
  let added = 0;
  for (const m of fb.mistakes) {
    const key = norm(m.wrong) + '→' + norm(m.right);
    if (!norm(m.wrong) && !norm(m.right)) continue;
    const existing = list.find((x) => norm(x.wrong) + '→' + norm(x.right) === key);
    if (existing) {
      existing.count = (existing.count || 1) + 1;
      existing.sentence = sentence; existing.corrected = fb.corrected; existing.ts = Date.now();
      if (existing.mastered) { existing.mastered = false; existing.box = 0; existing.due = Date.now(); }
      continue;
    }
    list.push({
      id: uid(), sentence, corrected: fb.corrected, wrong: m.wrong, right: m.right,
      type: m.type, explanation: m.explanation, ts: Date.now(), box: 0, due: Date.now(), mastered: false, count: 1,
    });
    added++;
  }
  return added;
}

export function dueMistakes() {
  const now = Date.now();
  return store.state.mistakes.filter((m) => !m.mastered && (m.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0));
}

export function addWord({ word, meaning = '', example = '', source = 'manual' }) {
  const w = (word || '').trim();
  if (!w) return false;
  const exists = store.state.vocab.find((v) => v.word.toLowerCase() === w.toLowerCase());
  if (exists) return false;
  store.state.vocab.push({ id: uid(), word: w, meaning, example, source, ts: Date.now(), mastered: false });
  return true;
}
export const hasWord = (word) => store.state.vocab.some((v) => v.word.toLowerCase() === (word || '').trim().toLowerCase());
