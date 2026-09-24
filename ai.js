// Picks the provider the app talks to. Everything else in the app calls these.
import { store } from './store.js';
import { ApiError } from './errors.js';
import * as claude from './claude.js';
import * as gemini from './gemini.js';

export { ApiError };

export const PROVIDERS = {
  claude: {
    id: 'claude',
    label: 'Claude',
    tag: 'paid',
    blurb: 'Pay-as-you-go. Your sentences are never used for training.',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    keyHint: 'sk-ant-…',
    adapter: claude,
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    tag: 'free',
    blurb: 'Free tier with daily limits. Google may use what you send to improve their products, so keep real names, employers and salary details out of it.',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyHint: 'AIza… or AQ…',
    adapter: gemini,
  },
};

export const providerId = () => (PROVIDERS[store.state.settings.provider] ? store.state.settings.provider : 'claude');
export const provider = () => PROVIDERS[providerId()];
const adapter = () => provider().adapter;

export const MODELS = () => adapter().MODELS;
export const chatModel = () => adapter().chatModel();
export const reportModel = () => adapter().reportModel();

export const streamText = (opts) => adapter().streamText(opts);
export const callTool = (opts) => adapter().callTool(opts);
export const testKey = (key, id = providerId()) => PROVIDERS[id].adapter.testKey(key);
export const listModels = (key) => (gemini.listModels ? gemini.listModels(key) : Promise.resolve([]));
export const isFree = (id = providerId()) => PROVIDERS[id].tag === 'free';
