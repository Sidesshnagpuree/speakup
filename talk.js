import { h, iconBtn, confirmSheet, toast } from './ui.js';
import { I } from './icons.js';
import { store } from './store.js';
import { Chat } from './chat.js';
import { TOPICS, tutorSystem, kickoffText, topicSwitchText } from './prompts.js';
import { canListen } from './speech.js';
import { getApiKey } from './store.js';

export function createTalk(app) {
  const el = h('section', { class: 'view', id: 'view-talk', 'aria-label': 'Talk' });
  const chips = h('div', { class: 'chips', role: 'toolbar', 'aria-label': 'Conversation topic' });
  const chatEl = h('div', { class: 'chat' });
  el.append(chips, chatEl);

  const s = () => store.state.settings;
  const chat = new Chat({
    el: chatEl,
    thread: () => store.state.talk,
    system: () => tutorSystem(s(), store.state.talk.topic),
    partner: () => s().tutorName || 'Maya',
    showCorrections: () => s().corrections,
    onChange: () => app.refreshBadges(),
    emptyState: () => h('div', { class: 'empty' },
      h('div', { class: 'art', html: I.mic }),
      h('h2', null, 'Practise speaking English'),
      h('p', null, canListen
        ? `Tap the mic and say anything — ${s().tutorName || 'Maya'} will reply out loud and you'll see corrections under each sentence.`
        : `Type a message to start. (Voice input isn't supported in this browser — try Chrome on Android.)`),
      h('button', { class: 'btn primary', type: 'button', onclick: () => start() }, `Let ${s().tutorName || 'Maya'} start`)),
  });

  function start() {
    if (!getApiKey()) { app.needKey(); return; }
    chat.kickoff(kickoffText(store.state.talk.topic));
  }

  function renderChips() {
    const cur = store.state.talk.topic;
    chips.replaceChildren(...TOPICS.map((t) => h('button', {
      class: 'chip', type: 'button', 'aria-pressed': String(t.id === cur),
      onclick: () => setTopic(t.id),
    }, t.label)));
  }

  function setTopic(id) {
    if (store.state.talk.topic === id) return;
    store.state.talk.topic = id;
    store.save();
    renderChips();
    const visible = store.state.talk.messages.some((m) => !m.hidden);
    if (visible && getApiKey() && !chat.busy) chat.kickoff(topicSwitchText(id));
    else toast('Topic: ' + (TOPICS.find((t) => t.id === id)?.label || id));
  }

  async function newChat() {
    if (!store.state.talk.messages.length) return;
    const ok = await confirmSheet('Start a new conversation?', { ok: 'New chat', detail: 'This clears the current chat. Saved mistakes, words and progress stay.' });
    if (!ok) return;
    chat.pause();
    chat.abort?.abort();
    store.state.talk.messages = [];
    store.save();
    chat.render();
  }

  renderChips();
  chat.render();

  return {
    id: 'talk', el, title: 'Talk', chat,
    actions: () => [iconBtn('newchat', 'New conversation', newChat)],
    onShow() { chat.scroll(true); },
    onHide() { chat.pause(); },
    refresh() { renderChips(); chat.render(); },
  };
}
