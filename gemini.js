// Google Gemini adapter (free tier). Same shape as claude.js so the app can switch providers.
import { store, getApiKey, recordUsage } from './store.js';
import { ApiError } from './errors.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const MODELS = {
  fast: { id: 'gemini-3.5-flash-lite', name: 'Flash Lite', note: 'Fastest, free tier' },
  smart: { id: 'gemini-3.8-flash', name: 'Flash', note: 'Better corrections, free tier' },
};

export function chatModel() {
  const s = store.state.settings;
  return (s.geminiModel || '').trim() || (MODELS[s.model] || MODELS.fast).id;
}
export function reportModel() {
  const s = store.state.settings;
  if ((s.geminiModel || '').trim()) return s.geminiModel.trim();
  return s.smartReports ? MODELS.smart.id : chatModel();
}

async function toError(res) {
  let body = null;
  try { body = await res.json(); } catch (e) { /* ignore */ }
  const m = body?.error?.message || res.statusText || 'Request failed';
  const reason = body?.error?.details?.find?.((d) => d.reason)?.reason || '';
  if (res.status === 400 && /API key not valid|API_KEY_INVALID/i.test(m + reason)) {
    return new ApiError('Your Gemini API key was rejected. Check it in Settings.', 'auth', 400);
  }
  if (res.status === 429) {
    return new ApiError("Gemini's free limit is used up for now. Wait a minute, or switch to Claude in Settings.", 'rate', 429);
  }
  if (res.status === 403) return new ApiError('Gemini refused this key (' + m + ').', 'forbidden', 403);
  if (res.status === 404) return new ApiError(`That Gemini model isn't available (${m}). Pick another one in Settings.`, 'model', 404);
  if (res.status === 503 || res.status >= 500) return new ApiError('Gemini is busy right now. Try again in a moment.', 'overloaded', res.status);
  return new ApiError(m, 'error', res.status);
}

async function post(path, body, { signal, key } = {}) {
  const k = key || getApiKey('gemini');
  if (!k) throw new ApiError('Add your Gemini API key in Settings first.', 'nokey', 0);
  let res;
  try {
    res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': k },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(navigator.onLine === false
      ? "You're offline. Connect to the internet and try again."
      : "Couldn't reach Gemini. Check your internet connection and try again.", 'network', 0);
  }
  if (!res.ok) {
    const err = await toError(res);
    // Older models reject thinkingLevel — retry once without it.
    if (err.status === 400 && body.generationConfig?.thinkingLevel && /thinking/i.test(err.message)) {
      const retry = { ...body, generationConfig: { ...body.generationConfig } };
      delete retry.generationConfig.thinkingLevel;
      return post(path, retry, { signal, key });
    }
    throw err;
  }
  return res;
}

function buildBody({ system, messages, maxTokens }) {
  return {
    systemInstruction: system ? { parts: [{ text: system }] } : undefined,
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: { maxOutputTokens: maxTokens, thinkingLevel: 'low' },
  };
}

const usageFrom = (u) => ({
  input_tokens: u?.promptTokenCount || 0,
  output_tokens: (u?.candidatesTokenCount || 0) + (u?.thoughtsTokenCount || 0),
});

function blockedError(json) {
  const reason = json?.promptFeedback?.blockReason || json?.candidates?.[0]?.finishReason;
  if (reason === 'SAFETY' || reason === 'PROHIBITED_CONTENT' || json?.promptFeedback?.blockReason) {
    return new ApiError("Gemini blocked that one. Rephrase it, or switch to Claude in Settings.", 'blocked', 0);
  }
  return null;
}

/** Stream a plain-text reply. Gemini's thinking tokens share the output budget, so the budget is generous. */
export async function streamText({ system, messages, maxTokens = 350, model = chatModel(), onText, signal }) {
  const body = buildBody({ system, messages, maxTokens: Math.max(maxTokens, 1200) });
  const res = await post(`/models/${model}:streamGenerateContent?alt=sse`, body, { signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let text = '';
  let usage = null;
  let blocked = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true }).replace(/\r/g, '');
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const data = chunk.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('');
      if (!data || data === '[DONE]') continue;
      let ev;
      try { ev = JSON.parse(data); } catch (e) { continue; }
      if (ev.usageMetadata) usage = ev.usageMetadata;
      blocked = blocked || blockedError(ev);
      for (const p of ev.candidates?.[0]?.content?.parts || []) {
        if (p.text) { text += p.text; onText?.(text, p.text); }
      }
    }
  }
  recordUsage(model, usageFrom(usage));
  if (!text.trim()) throw blocked || new ApiError('Gemini sent an empty reply. Try again.', 'empty', 0);
  return text;
}

/* ---------- JSON Schema → Gemini function parameters ---------- */
const DROP = new Set(['additionalProperties', '$schema', 'default', 'minimum', 'maximum', 'title', 'examples']);
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROP.has(k)) continue;
    if (k === 'type' && Array.isArray(v)) { out.type = v.find((t) => t !== 'null') || 'string'; continue; }
    if (k === 'properties') {
      out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
      continue;
    }
    out[k] = (v && typeof v === 'object') ? toGeminiSchema(v) : v;
  }
  return out;
}

/** Force one function call and return its arguments. */
export async function callTool({ system, messages, tool, maxTokens = 900, model = chatModel(), signal }) {
  const body = {
    ...buildBody({ system, messages, maxTokens: Math.max(maxTokens, 1600) }),
    tools: [{ functionDeclarations: [{ name: tool.name, description: tool.description, parameters: toGeminiSchema(tool.input_schema) }] }],
    toolConfig: { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tool.name] } },
  };
  const res = await post(`/models/${model}:generateContent`, body, { signal });
  const json = await res.json();
  recordUsage(model, usageFrom(json.usageMetadata));
  const parts = json.candidates?.[0]?.content?.parts || [];
  const call = parts.find((p) => p.functionCall);
  if (!call) throw blockedError(json) || new ApiError('Gemini returned an unexpected answer. Try again.', 'format', 0);
  return call.functionCall.args || {};
}

export async function testKey(key) {
  const model = chatModel();
  const res = await post(`/models/${model}:generateContent`, {
    contents: [{ role: 'user', parts: [{ text: 'Say OK.' }] }],
    generationConfig: { maxOutputTokens: 512, thinkingLevel: 'low' },
  }, { key });
  const json = await res.json();
  recordUsage(model, usageFrom(json.usageMetadata));
  return true;
}

/** Text models this key can actually use — keeps working when Google renames models. */
export async function listModels(key) {
  const k = key || getApiKey('gemini');
  if (!k) return [];
  let res;
  try {
    res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': k } });
  } catch (e) {
    return [];
  }
  if (!res.ok) return [];
  const json = await res.json().catch(() => ({}));
  return (json.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => ({ id: String(m.name || '').replace('models/', ''), label: m.displayName || '' }))
    .filter((m) => /flash|lite/i.test(m.id) && !/tts|image|embedding|live|transcribe|translate/i.test(m.id));
}
