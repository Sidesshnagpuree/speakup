import { h, btn, openSheet, toast, field, seg, toggle, confirmSheet } from './ui.js';
import { I } from './icons.js';
import { store, getApiKey, setApiKey } from './store.js';
import { PROVIDERS, providerId, testKey, listModels } from './ai.js';
import { LEVELS, ACCENTS, STT_LANGS } from './prompts.js';
import { canListen, canSpeak, englishVoices, say, unlockAudio } from './speech.js';

export const APP_VERSION = '1.1.1';

const levelSeg = (s, onChange) => seg(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), s.level, onChange);

/** Key input + "Save & test" for one provider. */
function keyField(pid, onSaved) {
  const p = PROVIDERS[pid];
  const wrap = h('div');
  const input = h('input', {
    class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
    placeholder: p.keyHint, value: getApiKey(pid), 'aria-label': p.label + ' API key',
  });
  const showBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; showBtn.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const msg = h('div', { class: 'hint' });
  const save = h('button', { class: 'btn primary sm', type: 'button' }, 'Save & test');
  save.addEventListener('click', async () => {
    const k = input.value.trim();
    if (!k) { msg.textContent = 'Paste your key first.'; msg.style.color = 'var(--bad)'; return; }
    if (/\s/.test(k) || k.length < 20) { msg.textContent = 'That looks too short to be an API key — paste the whole thing.'; msg.style.color = 'var(--bad)'; return; }
    save.disabled = true; msg.style.color = ''; msg.textContent = 'Testing…';
    const before = getApiKey(pid);
    try {
      setApiKey(k, pid);          // adapters read the stored key
      await testKey(k, pid);
      msg.textContent = '✓ Key works and is saved on this phone.'; msg.style.color = 'var(--good)';
      if (pid === 'gemini') {
        const models = await listModels(k);
        if (models.length) { store.state.settings.geminiModelList = models; store.save(); }
      }
      onSaved?.();
    } catch (e) {
      setApiKey(before, pid);
      msg.textContent = e.message; msg.style.color = 'var(--bad)';
    }
    save.disabled = false;
  });
  wrap.append(input, h('div', { class: 'row', style: { marginTop: '8px' } }, showBtn, h('span', { class: 'grow' }), save), msg);
  return wrap;
}

function providerNote(pid) {
  const p = PROVIDERS[pid];
  return h('div', { class: pid === 'gemini' ? 'note' : 'hint', style: { marginTop: '10px' } },
    h('b', null, p.tag === 'free' ? 'Free: ' : 'Paid: '), p.blurb);
}

function voiceSelect(s) {
  const sel = h('select', { class: 'select input', 'aria-label': 'Tutor voice' });
  const fill = () => {
    const vs = englishVoices();
    sel.replaceChildren(h('option', { value: '' }, 'Automatic (best for accent)'),
      ...vs.map((v) => h('option', { value: v.voiceURI, selected: v.voiceURI === s.voiceURI }, `${v.name} (${v.lang})`)));
  };
  fill();
  if (canSpeak) { try { speechSynthesis.addEventListener('voiceschanged', fill); } catch (e) { /* ignore */ } }
  sel.addEventListener('change', () => { s.voiceURI = sel.value; store.save(); });
  return sel;
}

/** Provider picker + key + models. Used in Settings and in onboarding. */
export function providerGroup(app, onChange) {
  const s = store.state.settings;
  const box = h('div');
  const draw = () => {
    const pid = providerId();
    const p = PROVIDERS[pid];
    const M = p.adapter.MODELS;
    const body = [];
    body.push(h('div', { class: 'field' }, h('span', { class: 'label' }, 'AI engine'),
      seg(Object.values(PROVIDERS).map((x) => [x.id, x.label + (x.tag === 'free' ? ' · free' : '')]), pid, (v) => {
        s.provider = v; store.save(); draw(); onChange?.();
      })));
    body.push(providerNote(pid));
    body.push(h('div', { class: 'divider' }));
    body.push(h('div', { class: 'field' }, h('span', { class: 'label' }, `${p.label} API key`), keyField(pid, () => onChange?.())));
    body.push(h('small', { class: 'hint' }, 'Stored only in this phone\'s browser. Get a key at ',
      h('a', { href: p.keyUrl, target: '_blank', rel: 'noopener' }, p.keyUrl.replace('https://', '').split('/')[0]), '.'));
    body.push(h('div', { class: 'divider' }));
    body.push(field('Model', seg([['fast', M.fast.name], ['smart', M.smart.name]], s.model, (v) => { s.model = v; store.save(); onChange?.(); }),
      `${M.fast.name}: ${M.fast.note}. ${M.smart.name}: ${M.smart.note}.`));
    body.push(toggle(`Use ${M.smart.name} for role-play reports`, s.smartReports, (v) => { s.smartReports = v; store.save(); }, 'End-of-session feedback is worth the better model'));
    if (pid === 'gemini') {
      const list = s.geminiModelList || [];
      const sel = h('select', { class: 'select input', 'aria-label': 'Gemini model' },
        h('option', { value: '' }, 'Automatic (recommended)'),
        ...list.map((m) => h('option', { value: m.id, selected: m.id === s.geminiModel }, m.label ? `${m.label} (${m.id})` : m.id)));
      sel.addEventListener('change', () => { s.geminiModel = sel.value; store.save(); });
      body.push(h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, 'Advanced'),
        field('Exact Gemini model', sel, list.length ? 'Models this key can use.' : 'Save your key to load the list.')));
    } else {
      body.push(h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, 'Advanced'),
        field('Custom model ID', h('input', { class: 'input', value: s.modelOverride, placeholder: 'e.g. claude-opus-5', spellcheck: 'false', autocapitalize: 'off', oninput: (e) => { s.modelOverride = e.target.value.trim(); store.save(); } }),
          'Overrides the model above. Leave empty normally.')));
    }
    box.replaceChildren(...body);
  };
  draw();
  return box;
}

export function openSettings(app) {
  const s = store.state.settings;
  const save = () => { store.save(); };
  let vsWrap;
  let rateOut;
  openSheet({
    title: 'Settings',
    full: true,
    onClose: () => app.refreshAll(),
    content: (body) => {
      body.append(h('div', { class: 'group' }, h('h3', null, 'AI engine'), providerGroup(app, () => app.updateHeader())));

      body.append(h('div', { class: 'group' },
        h('h3', null, 'About you'),
        field('Your name', h('input', { class: 'input', value: s.name, placeholder: 'What should the tutor call you?', oninput: (e) => { s.name = e.target.value; save(); } })),
        field('About you (optional)', h('textarea', { class: 'input', rows: 3, placeholder: 'Your job, goals, interests — helps the tutor personalise conversations and interviews.', oninput: (e) => { s.about = e.target.value; save(); } }, s.about)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'English level'), levelSeg(s, (v) => { s.level = v; save(); })),
        field('Daily goal', seg([[10, '10'], [20, '20'], [30, '30'], [50, '50']], Number(s.dailyGoal), (v) => { s.dailyGoal = v; save(); }), 'Sentences per day')));

      body.append(h('div', { class: 'group' },
        h('h3', null, 'Voice'),
        !canListen ? h('div', { class: 'note', style: { marginBottom: '10px' } }, 'Voice input isn\'t available in this browser. Use Chrome on Android (or Safari on iPhone) for speaking practice.') : null,
        field('Your accent (for speech recognition)', seg(Object.entries(STT_LANGS).map(([k, v]) => [k, v.split(' ')[0]]), s.sttLang, (v) => { s.sttLang = v; save(); }), 'Pick the one that understands you best'),
        field('Tutor voice accent', seg(Object.entries(ACCENTS).map(([k, v]) => [k, v.label]), s.accent, (v) => { s.accent = v; s.voiceURI = ''; save(); vsWrap.replaceChildren(voiceSelect(s)); })),
        field('Tutor voice', (vsWrap = h('div', null, voiceSelect(s)))),
        field('Speaking speed', h('div', { class: 'row' },
          h('input', { type: 'range', min: '0.7', max: '1.3', step: '0.05', value: String(s.rate), 'aria-label': 'Speaking speed', oninput: (e) => { s.rate = Number(e.target.value); rateOut.textContent = s.rate.toFixed(2) + '×'; save(); } }),
          (rateOut = h('b', { style: { minWidth: '52px', textAlign: 'right' } }, Number(s.rate).toFixed(2) + '×')))),
        h('div', { style: { margin: '10px 0' } }, btn('Test voice', () => { unlockAudio(); say(`Hi${s.name ? ' ' + s.name : ''}! This is how I sound. Shall we practise some English?`); }, { cls: 'soft sm', ico: 'speaker' })),
        toggle('Read replies aloud', s.autoSpeak, (v) => { s.autoSpeak = v; save(); }),
        toggle('Send automatically when I stop speaking', s.autoSend, (v) => { s.autoSend = v; save(); }, 'Turn off if it cuts you off when you pause — then tap the mic again to keep adding, and send when ready'),
        toggle('Hands-free mode', s.handsFree, (v) => { s.handsFree = v; save(); }, 'Mic opens by itself after each reply')));

      body.append(h('div', { class: 'group' },
        h('h3', null, 'Tutor'),
        field('Tutor\'s name', h('input', { class: 'input', value: s.tutorName, oninput: (e) => { s.tutorName = e.target.value.trim() || 'Maya'; save(); } })),
        toggle('Correct my sentences in Talk', s.corrections, (v) => { s.corrections = v; save(); }),
        field('Correction style', seg([['errors', 'Mistakes only'], ['natural', 'Mistakes + natural phrasing']], s.correctionStyle, (v) => { s.correctionStyle = v; save(); }))));

      body.append(h('div', { class: 'group' },
        h('h3', null, 'Appearance'),
        seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => { s.theme = v; save(); app.applyTheme(); })));

      body.append(h('div', { class: 'group' },
        h('h3', null, 'Data'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Everything is stored on this phone. Your sentences go only to the AI engine you picked above. Export a backup from the Progress tab.'),
        h('div', { class: 'row wrap' },
          btn('Remove API keys', async () => {
            if (!(await confirmSheet('Remove your API keys from this phone?', { ok: 'Remove', danger: true }))) return;
            setApiKey('', 'claude'); setApiKey('', 'gemini'); toast('API keys removed'); app.refreshAll();
          }, { cls: 'sm danger' }),
          btn('Reset all data', async () => {
            if (!(await confirmSheet('Reset everything?', { ok: 'Reset', danger: true, detail: 'Deletes conversations, mistakes, words, progress and settings on this phone. Your API keys stay.' }))) return;
            store.reset(); store.save(); toast('All data reset'); location.reload();
          }, { cls: 'sm danger' }))));

      body.append(h('p', { class: 'muted small', style: { textAlign: 'center', margin: '18px 0 8px' } }, `SpeakUp ${APP_VERSION}`));
    },
  });
}

/* ---------- First-run setup ---------- */
export function openOnboarding(app, { startStep = 0 } = {}) {
  const s = store.state.settings;
  let step = startStep;
  const sheet = openSheet({
    full: true,
    dismissable: false,
    content: (body, api) => {
      const draw = () => {
        body.replaceChildren();
        const d = h('div', { class: 'onb' });
        d.append(h('div', { class: 'steps-dots' }, [0, 1, 2].map((i) => h('i', { class: i === step ? 'on' : '' }))));
        if (step === 0) {
          d.append(
            h('img', { class: 'logo', src: 'icon-192.png', alt: '' }),
            h('h1', null, 'SpeakUp'),
            h('p', { class: 'lead' }, 'Your AI English tutor. Talk out loud, get instant corrections, practise interviews and track your progress.'),
            field('Your name', h('input', { class: 'input', value: s.name, placeholder: 'What should the tutor call you?', oninput: (e) => { s.name = e.target.value; } })),
            h('div', { class: 'field' }, h('span', { class: 'label' }, 'Your English level'), levelSeg(s, (v) => { s.level = v; })),
            field('About you (optional)', h('textarea', { class: 'input', rows: 3, placeholder: 'e.g. I work in finance operations and I\'m preparing for interviews.', oninput: (e) => { s.about = e.target.value; } }, s.about)),
            h('div', { style: { marginTop: '20px' } }, btn('Continue', () => { store.save(); step = 1; draw(); }, { cls: 'primary block' })));
        } else if (step === 1) {
          d.append(
            h('h1', null, 'Voice'),
            h('p', { class: 'lead' }, canListen ? 'SpeakUp listens to you and talks back.' : 'Voice input isn\'t available in this browser — you can still type. For speaking practice, open this app in Chrome on Android.'),
            field('Your accent', seg(Object.entries(STT_LANGS).map(([k, v]) => [k, v.split(' ')[0]]), s.sttLang, (v) => { s.sttLang = v; }), 'Helps the app understand you. Indian English usually works best for an Indian accent.'),
            field('Tutor voice', seg(Object.entries(ACCENTS).map(([k, v]) => [k, v.label]), s.accent, (v) => { s.accent = v; s.voiceURI = ''; })),
            h('div', { style: { margin: '12px 0' } }, btn('Hear the tutor', () => { unlockAudio(); say(`Hi${s.name ? ' ' + s.name : ''}! I'm ${s.tutorName}. I can't wait to chat with you.`); }, { cls: 'soft', ico: 'speaker' })),
            h('div', { class: 'row', style: { marginTop: '20px' } },
              btn('Back', () => { step = 0; draw(); }, { cls: 'grow' }),
              btn('Continue', () => { store.save(); step = 2; draw(); }, { cls: 'primary grow' })));
        } else {
          d.append(
            h('h1', null, 'Connect an AI'),
            h('p', { class: 'lead' }, 'SpeakUp uses your own key. It stays on this phone, and you can switch engines any time in Settings.'),
            providerGroup(app, () => { if (getApiKey()) finishBtn.replaceChildren('Finish'); }),
            h('div', { class: 'row', style: { marginTop: '20px' } },
              btn('Back', () => { step = 1; draw(); }, { cls: 'grow' }),
              (finishBtn = btn(getApiKey() ? 'Finish' : 'Skip for now', () => finish(), { cls: 'grow primary' }))));
        }
        body.append(d);
      };
      let finishBtn;
      const finish = () => { s.onboarded = true; store.save(); api.close(); app.refreshAll(); };
      draw();
    },
  });
  return sheet;
}
