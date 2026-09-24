// Direct calls from the phone to the Anthropic Messages API.
import { store, getApiKey, recordUsage } from './store.js';

const API = 'https://api.anthropic.com/v1/messages';

export const MODELS = {
  fast: { id: 'claude-haiku-4-5-20251001', name: 'Haiku 4.5', note: 'Fastest replies, lowest cost' },
  smart: { id: 'claude-sonnet-5', name: 'Sonnet 5', note: 'Richer explanations, about 2× the cost' },
};

export function chatModel() {
  const s = store.state.settings;
  return (s.modelOverride || '').trim() || (MODELS[s.model] || MODELS.fast).id;
}
export function reportModel() {
  const s = store.state.settings;
  if ((s.modelOverride || '').trim()) return s.modelOverride.trim();
  return s.smartReports ? MODELS.smart.id : chatModel();
}

export class ApiError extends Error {
  constructor(message, code = 'error', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function headers(key) {
  return {
    'content-type': 'application/json',
    'x-api-key': key,
    'anthropic-version': '2023-06-01',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
}

async function toError(res) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* ignore */ }
  const m = body?.error?.message || res.statusText || 'Request failed';
  const t = body?.error?.type || '';
  if (res.status === 401) return new ApiError('Your API key was rejected. Check it in Settings.', 'auth', 401);
  if (/credit balance/i.test(m)) return new ApiError('Your Anthropic account is out of credits. Add credits at console.anthropic.com → Billing.', 'credits', res.status);
  if (res.status === 403) return new ApiError('This API key is not allowed to do that (' + m + ').', 'forbidden', 403);
  if (res.status === 404 || t === 'not_found_error') return new ApiError(`That model isn't available (${m}). Pick another model in Settings.`, 'model', res.status);
  if (res.status === 429) return new ApiError('Rate limit reached — wait a few seconds and try again.', 'rate', 429);
  if (res.status === 529 || t === 'overloaded_error') return new ApiError('Claude is busy right now. Try again in a moment.', 'overloaded', res.status);
  if (res.status >= 500) return new ApiError('Anthropic had a server error. Try again shortly.', 'server', res.status);
  return new ApiError(m, t || 'error', res.status);
}

async function post(body, { signal, key } = {}) {
  const k = key || getApiKey();
  if (!k) throw new ApiError('Add your Claude API key in Settings first.', 'nokey', 0);
  let res;
  try {
    res = await fetch(API, { method: 'POST', headers: headers(k), body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(navigator.onLine === false
      ? "You're offline. Connect to the internet and try again."
      : "Couldn't reach Claude. Check your internet connection and try again.", 'network', 0);
  }
  if (!res.ok) throw await toError(res);
  return res;
}

/** Stream a plain-text reply. onText(fullSoFar, delta) fires as text arrives. */
export async function streamText({ system, messages, maxTokens = 350, model = chatModel(), onText, signal }) {
  const res = await post({ model, max_tokens: maxTokens, system, messages, stream: true }, { signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  const usage = { input_tokens: 0, output_tokens: 0 };
  const handle = (ev) => {
    switch (ev.type) {
      case 'message_start': {
        const u = ev.message?.usage || {};
        usage.input_tokens = u.input_tokens || 0;
        usage.cache_creation_input_tokens = u.cache_creation_input_tokens || 0;
        usage.cache_read_input_tokens = u.cache_read_input_tokens || 0;
        usage.output_tokens = u.output_tokens || 0;
        break;
      }
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta' && ev.delta.text) {
          text += ev.delta.text;
          onText?.(text, ev.delta.text);
        }
        break;
      case 'message_delta':
        if (ev.usage?.output_tokens != null) usage.output_tokens = ev.usage.output_tokens;
        break;
      case 'error':
        throw new ApiError(ev.error?.type === 'overloaded_error' ? 'Claude is busy right now. Try again in a moment.' : (ev.error?.message || 'Stream error'), ev.error?.type || 'stream', 0);
      default:
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('');
        if (!data) continue;
        let ev;
        try { ev = JSON.parse(data); } catch (e) { continue; }
        handle(ev);
      }
    }
  } finally {
    recordUsage(model, usage);
  }
  return text;
}

/** Force a single tool call and return its parsed input (structured JSON). */
export async function callTool({ system, messages, tool, maxTokens = 900, model = chatModel(), signal }) {
  const res = await post({
    model, max_tokens: maxTokens, system, messages,
    tools: [tool], tool_choice: { type: 'tool', name: tool.name },
  }, { signal });
  const json = await res.json();
  recordUsage(model, json.usage);
  const block = (json.content || []).find((b) => b.type === 'tool_use');
  if (!block) throw new ApiError('Claude returned an unexpected answer. Try again.', 'format', 0);
  return block.input || {};
}

/** Cheap call to confirm a key works. */
export async function testKey(key) {
  const model = chatModel();
  const res = await post({ model, max_tokens: 5, messages: [{ role: 'user', content: 'Say OK.' }] }, { key });
  const json = await res.json();
  recordUsage(model, json.usage);
  return true;
}
