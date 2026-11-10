import { t as translateText } from '../i18n/index.js';
/**
 * Failure modes of a generation, and what to say about each.
 *
 * Pure and network-free, so every message can be tested offline — which matters
 * more here than usual, because these are the only part of the feature a user
 * meets when something goes wrong, and a generic "request failed" would leave
 * them with no idea whether to fix their key, wait a minute, reword the prompt,
 * or reconnect to the internet.
 *
 * The rule the tests enforce: every code produces a message that names the
 * provider and says what to do next. A new code cannot be added without one.
 */

export const GEN_ERRORS = {
  NO_KEY: 'no-key',
  NO_CONSENT: 'no-consent',
  BAD_KEY: 'bad-key',
  RATE_LIMIT: 'rate-limit',
  QUOTA: 'quota',
  REFUSED: 'refused',
  OFFLINE: 'offline',
  ABORTED: 'aborted',
  TIMEOUT: 'timeout',
  BAD_RESPONSE: 'bad-response',
  SERVER: 'server',
  UNKNOWN: 'unknown',
};

export class GenerationError extends Error {
  /**
   * @param {string} code one of GEN_ERRORS
   * @param {string} [detail] operator-facing detail; never shown raw to the user
   * @param {{status?:number, retryAfter?:number, provider?:string}} [meta]
   */
  constructor(code, detail = '', meta = {}) {
    super(detail || code);
    this.name = 'GenerationError';
    this.code = code;
    this.detail = detail;
    this.status = meta.status || 0;
    this.retryAfter = meta.retryAfter || 0;
    this.provider = meta.provider || 'the provider';
  }
}

/**
 * An HTTP failure to a coded error.
 *
 * Status alone is not enough — 400 covers both "your prompt was refused" and
 * "your request was malformed", which need completely different advice, so the
 * body's own code is consulted where there is one.
 *
 * @param {number} status
 * @param {object|null} body parsed JSON, or null when it did not parse
 * @param {string} provider display name
 * @param {object} [headers] plain object, lower-cased keys
 * @returns {GenerationError}
 */
export function mapHttpError(status, body, provider, headers = {}) {
  const err = (body && (body.error || body)) || {};
  const code = String(err.code || err.type || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();
  const meta = { status, provider };

  if (status === 401 || status === 403) return new GenerationError(GEN_ERRORS.BAD_KEY, err.message, meta);
  if (status === 429) {
    const retryAfter = Number(headers['retry-after']) || 0;
    return new GenerationError(GEN_ERRORS.RATE_LIMIT, err.message, { ...meta, retryAfter });
  }
  if (status === 402 || code.includes('quota') || code.includes('billing') || message.includes('quota')) {
    return new GenerationError(GEN_ERRORS.QUOTA, err.message, meta);
  }
  if (code.includes('content_policy') || code.includes('moderation') || code.includes('safety')
    || message.includes('content policy') || message.includes('safety system')) {
    return new GenerationError(GEN_ERRORS.REFUSED, err.message, meta);
  }
  if (status >= 500) return new GenerationError(GEN_ERRORS.SERVER, err.message, meta);
  if (status >= 400) return new GenerationError(GEN_ERRORS.BAD_RESPONSE, err.message, meta);
  return new GenerationError(GEN_ERRORS.UNKNOWN, err.message, meta);
}

/**
 * A thrown fetch/abort/decode failure to a coded error.
 *
 * `fetch` rejects with a bare TypeError for every network-layer problem — no
 * connection, DNS failure, CORS refusal — so that is the best available signal
 * for "offline", and the message stays hedged accordingly.
 *
 * @param {Error} err
 * @param {string} provider
 * @returns {GenerationError}
 */
export function mapThrown(err, provider) {
  if (err instanceof GenerationError) return err;
  const name = err && err.name;
  if (name === 'AbortError') return new GenerationError(GEN_ERRORS.ABORTED, '', { provider });
  if (name === 'TimeoutError') return new GenerationError(GEN_ERRORS.TIMEOUT, '', { provider });
  if (name === 'TypeError') return new GenerationError(GEN_ERRORS.OFFLINE, err.message, { provider });
  return new GenerationError(GEN_ERRORS.UNKNOWN, (err && err.message) || String(err), { provider });
}

/**
 * What the user reads, and what they can do about it.
 *
 * @param {GenerationError} err
 * @returns {{text: string, action: string|null}} action is a command id or null
 */
export function messageFor(err) {
  const p = !err?.provider || err.provider === 'the provider' ? translateText('the provider') : err.provider;
  switch (err && err.code) {
    case GEN_ERRORS.NO_KEY:
      return { text: translateText("Generative Fill needs your own {0} API key. Nothing is sent until you add one.", p), action: 'key' };
    case GEN_ERRORS.NO_CONSENT:
      return { text: translateText("Generative Fill did not send anything, because sending to {0} has not been agreed to yet.", p), action: 'consent' };
    case GEN_ERRORS.BAD_KEY:
      return { text: translateText("{0} rejected the API key. Check that it is current and allowed to generate images.", p), action: 'key' };
    case GEN_ERRORS.RATE_LIMIT:
      return {
        text: err.retryAfter
          ? translateText("Rate limited by {0}. Try again in {1} seconds.", p, err.retryAfter)
          : translateText("Rate limited by {0}. Try again in a moment.", p),
        action: null,
      };
    case GEN_ERRORS.QUOTA:
      return { text: translateText("Your {0} account is out of credit. This attempt was not charged.", p), action: null };
    case GEN_ERRORS.REFUSED:
      return { text: translateText("{0} declined this prompt. Describing the result rather than the subject often helps.", p), action: null };
    case GEN_ERRORS.OFFLINE:
      return { text: translateText("No connection. Generative Fill is the one thing in Pikado that needs one — everything else still works."), action: null };
    case GEN_ERRORS.ABORTED:
      return { text: translateText("Stopped. {0} may still charge for a generation that had already started.", p), action: null };
    case GEN_ERRORS.TIMEOUT:
      return { text: translateText("No answer from {0} after two minutes. It may be overloaded — try again.", p), action: null };
    case GEN_ERRORS.BAD_RESPONSE:
      return { text: translateText("{0} returned something Pikado could not read. Nothing was changed.", p), action: null };
    case GEN_ERRORS.SERVER:
      return { text: translateText("{0} is having trouble{1}. Nothing was charged for a failed request.", p, err.status ? ` (${err.status})` : ''), action: null };
    default:
      return { text: translateText("Generative Fill failed and {0} did not say why. Nothing was changed.", p), action: null };
  }
}
