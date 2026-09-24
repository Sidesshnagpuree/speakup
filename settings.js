import { h, btn, openSheet, toast, field, seg, toggle, confirmSheet } from './ui.js';
import { I } from './icons.js';
import { store, getApiKey, setApiKey } from './store.js';
import { MODELS, testKey } from './claude.js';
import { LEVELS, ACCENTS, STT_LANGS } from './prompts.js';
import { canListen, canSpeak, englishVoices, say, unlockAudio } from './speech.js';

export const APP_VERSION = '1.0.0';

const levelSeg = (s, onChange) => seg(Object.entries(LEVELS).map(([k, v]) => [k, v.label]), s.level, onChange);

function keyField(onSaved) {
  const wrap = h('div');
  const input = h('input', {
    class: 'input', type: 'password', autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off',
    placeholder: 'sk-ant-…', value: getApiKey(), 'aria-label': 'Claude API key',
  });
  const showBtn = h('button', { class: 'btn sm', type: 'button', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; showBtn.textContent = input.type === 'password' ? 'Show' : 'Hide'; } }, 'Show');
  const msg = h('div', { class: 'hint' });
  const save = h('button', { class: 'btn primary sm', type: 'button' }, 'Save & test');
  save.addEventListener('click', async () => {
    const k = input.value.trim();
    if (!k) { msg.textContent = 'Paste your key first.'; msg.style.color = 'var(--bad)'; return; }
    if (!/^sk-ant-/.test(k)) { msg.textContent = 'That doesn\'t look like a Claude key (they start with sk-ant-).'; msg.style.color = 'var(--bad)'; return; }
    save.disabled = true; msg.style.color = ''; msg.textContent = 'Testing…';
    try {
      await testKey(k);
      setApiKey(k);
      msg.textContent = '✓ Key works and is saved on this phone.'; msg.style.color = 'var(--good)';
      onSaved?.();
    } catch (e) {
      msg.textContent = e.message; msg.style.color = 'var(--bad)';
    }
    save.disabled = false;
  });
  wrap.append(input, h('div', { class: 'row', style: { marginTop: '8px' } }, showBtn, h('span', { class: 'grow' }), save), msg);
  return wrap;
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
      // --- Claude
      body.append(h('div', { class: 'group' },
        h('h3', null, 'Claude API key'),
        keyField(),
        h('small', { class: 'hint' }, 'Stored only in this phone\'s browser. Get a key at ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'), '.'),
        h('div', { class: 'divider' }),
        field('Model', seg(Object.entries(MODELS).map(([k, v]) => [k, v.name]), s.model, (v) => { s.model = v; save(); }),
          `${MODELS.fast.name}: ${MODELS.fast.note}. ${MODELS.smart.name}: ${MODELS.smart.note}.`),
        toggle('Smarter model for role-play reports', s.smartReports, (v) => { s.smartReports = v; save(); }, `Uses ${MODELS.smart.name} for end-of-session feedback`),
        h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'muted small', style: { cursor: 'pointer' } }, 'Advanced'),
          field('Custom model ID', h('input', { class: 'input', value: s.modelOverride, placeholder: 'e.g. claude-opus-5', spellcheck: 'false', autocapitalize: 'off', oninput: (e) => { s.modelOverride = e.target.value.trim(); save(); } }),
            'Overrides the model above for everything. Leave empty normally.'))));

      // --- You
      body.append(h('div', { class: 'group' },
        h('h3', null, 'About you'),
        field('Your name', h('input', { class: 'input', value: s.name, placeholder: 'What should the tutor call you?', oninput: (e) => { s.name = e.target.value; save(); } })),
        field('About you (optional)', h('textarea', { class: 'input', rows: 3, placeholder: 'Your job, goals, interests — helps the tutor personalise conversations and interviews.', oninput: (e) => { s.about = e.target.value; save(); } }, s.about)),
        h('div', { class: 'field' }, h('span', { class: 'label' }, 'English level'), levelSeg(s, (v) => { s.level = v; save(); })),
        field('Daily goal', seg([[10, '10'], [20, '20'], [30, '30'], [50, '50']], Number(s.dailyGoal), (v) => { s.dailyGoal = v; save(); }), 'Sentences per day')));

      // --- Voice
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

      // --- Tutor
      body.append(h('div', { class: 'group' },
        h('h3', null, 'Tutor'),
        field('Tutor\'s name', h('input', { class: 'input', value: s.tutorName, oninput: (e) => { s.tutorName = e.target.value.trim() || 'Maya'; save(); } })),
        toggle('Correct my sentences in Talk', s.corrections, (v) => { s.corrections = v; save(); }),
        field('Correction style', seg([['errors', 'Mistakes only'], ['natural', 'Mistakes + natural phrasing']], s.correctionStyle, (v) => { s.correctionStyle = v; save(); }))));

      // --- Appearance
      body.append(h('div', { class: 'group' },
        h('h3', null, 'Appearance'),
        seg([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], s.theme, (v) => { s.theme = v; save(); app.applyTheme(); })));

      // --- Data
      body.append(h('div', { class: 'group' },
        h('h3', null, 'Data'),
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Everything is stored on this phone. Your sentences are sent only to Anthropic\'s API to generate replies and corrections. Export a backup from the Progress tab.'),
        h('div', { class: 'row wrap' },
          btn('Remove API key', async () => {
            if (!(await confirmSheet('Remove your API key from this phone?', { ok: 'Remove', danger: true }))) return;
            setApiKey(''); toast('API key removed'); app.refreshAll();
          }, { cls: 'sm danger' }),
          btn('Reset all data', async () => {
            if (!(await confirmSheet('Reset everything?', { ok: 'Reset', danger: true, detail: 'Deletes conversations, mistakes, words, progress and settings on this phone. Your API key stays.' }))) return;
            store.reset(); store.save(); toast('All data reset'); location.reload();
          }, { cls: 'sm danger' }))));

      body.append(h('p', { class: 'muted small', style: { textAlign: 'center', margin: '18px 0 8px' } }, `SpeakUp ${APP_VERSION} · powered by Claude`));
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
            h('h1', null, 'Connect Claude'),
            h('p', { class: 'lead' }, 'SpeakUp uses your own Claude API key. It stays on this phone.'),
            h('ol', null,
              h('li', null, 'Open ', h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com → API keys'), ' and sign in.'),
              h('li', null, 'Add a few dollars of credit under Billing (pay-as-you-go).'),
              h('li', null, 'Create a key, copy it and paste it below.')),
            keyField(() => setTimeout(() => finish(), 700)),
            h('div', { class: 'note', style: { marginTop: '14px' } }, `Cost guide: with ${MODELS.fast.name}, a 15-minute voice session is usually around 10–20 US cents. Live usage is shown in Progress.`),
            h('div', { class: 'row', style: { marginTop: '20px' } },
              btn('Back', () => { step = 1; draw(); }, { cls: 'grow' }),
              btn(getApiKey() ? 'Finish' : 'Skip for now', () => finish(), { cls: 'grow' + (getApiKey() ? ' primary' : '') })));
        }
        body.append(d);
      };
      const finish = () => { s.onboarded = true; store.save(); api.close(); app.refreshAll(); };
      draw();
    },
  });
  return sheet;
}
