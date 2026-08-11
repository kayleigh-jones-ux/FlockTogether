// src/grouping.js — semantic answer clustering for Flock Together.
//
// Two paths:
//   groupAnswers(question, answers)  -> Claude API (authoritative). THROWS GroupingError on any failure.
//   fuzzyGroup(question, answers)    -> deterministic, dependency-free fallback. Never throws.
//
// The engine decides which path ran and reports it honestly as GameState.groupingSource
// (PRODUCT.md principle 5). Convenience wrapper groupAnswersWithFallback() does that
// try/catch for you and hands back the source label.
//
// Scoring is NOT computed here. The engine owns scoring.

/** @typedef {{ playerId: string, name: string, text: string }} Answer */
/** @typedef {{ id: string, label: string, answers: Answer[] }} Group */

const MODEL = 'claude-opus-5';
const MAX_TOKENS = 16000;
const CALL_TIMEOUT_MS = 10_000;

const SYSTEM_PROMPT = [
  'You cluster short free-text party-game answers by MEANING, not spelling.',
  '"soda", "pop" and "a coke" are one group. Casing, punctuation, articles and typos are irrelevant.',
  'Distinct concepts stay separate even when they look superficially similar.',
  'Every answer index must appear in exactly one group.',
  'Give each group a short 1-3 word human label in title case that names what the group MEANS.',
].join(' ');

// Index-based output: the model returns positions in the answers array, never answer text.
// A hallucinated or reworded answer therefore cannot corrupt game state.
const GROUPS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'members'],
        properties: {
          label: { type: 'string' },
          members: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
};

/**
 * Typed failure so the engine can tell a refusal from a timeout from bad model output.
 * `kind` is one of:
 *   'no_api_key' | 'sdk_missing' | 'timeout' | 'refusal' | 'no_text' | 'parse' | 'validation' | 'api'
 */
export class GroupingError extends Error {
  constructor(kind, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'GroupingError';
    this.kind = kind;
  }
}

/* ------------------------------------------------------------------ *
 * Claude path
 * ------------------------------------------------------------------ */

let clientPromise = null;

// Lazy dynamic import so a missing/uninstalled SDK degrades to the fallback path
// instead of crashing the server at module load.
async function getClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      let mod;
      try {
        mod = await import('@anthropic-ai/sdk');
      } catch (cause) {
        throw new GroupingError('sdk_missing', '@anthropic-ai/sdk is not installed', { cause });
      }
      const Anthropic = mod.default ?? mod.Anthropic;
      return new Anthropic({ maxRetries: 1 }); // reads ANTHROPIC_API_KEY
    })().catch((err) => {
      clientPromise = null; // let a later round retry
      throw err;
    });
  }
  return clientPromise;
}

function hasCredentials() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/**
 * Cluster answers by semantic similarity using Claude. Largest group first.
 * Throws GroupingError on missing credentials, timeout, refusal, unparseable output,
 * or a partition that does not cover every answer exactly once.
 *
 * @param {string} question
 * @param {Answer[]} answers
 * @returns {Promise<Group[]>}
 */
export async function groupAnswers(question, answers) {
  const list = Array.isArray(answers) ? answers : [];
  const started = Date.now();

  if (list.length === 0) {
    logLine('claude', 0, 0, Date.now() - started);
    return tag([], 'claude');
  }

  if (!hasCredentials()) {
    throw new GroupingError('no_api_key', 'ANTHROPIC_API_KEY is not set');
  }

  const client = await getClient();
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);

  let response;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS, // on claude-opus-5 thinking is ON by default and max_tokens
        // caps thinking PLUS output together, so this must be generous. 'low' effort — not a
        // token budget — is the correct latency lever for a task this simple.
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        output_config: {
          effort: 'low',
          format: { type: 'json_schema', schema: GROUPS_SCHEMA },
        },
        messages: [{ role: 'user', content: buildUserPrompt(question, list) }],
      },
      { signal },
    );
  } catch (cause) {
    if (signal.aborted || isAbort(cause)) {
      throw new GroupingError('timeout', `grouping call exceeded ${CALL_TIMEOUT_MS}ms`, { cause });
    }
    throw new GroupingError('api', `grouping call failed: ${cause?.message ?? cause}`, { cause });
  }

  // (1) refusal check FIRST, before touching response.content.
  if (response?.stop_reason === 'refusal') {
    const category = response?.stop_details?.category ?? 'unknown';
    throw new GroupingError('refusal', `model refused to group answers (${category})`);
  }

  // (2) first text content block.
  const textBlock = (response?.content ?? []).find((b) => b?.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string' || !textBlock.text.trim()) {
    throw new GroupingError('no_text', 'response contained no text block');
  }

  // (3) parse.
  let parsed;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (cause) {
    throw new GroupingError('parse', 'response text was not valid JSON', { cause });
  }

  // (4) validate the partition. Never trust the model's partition.
  const raw = validatePartition(parsed, list.length);

  const groups = raw
    .map((g) => ({
      label: cleanLabel(g.label, list[g.members[0]]?.text),
      answers: g.members.map((i) => list[i]),
    }))
    .sort((a, b) => b.answers.length - a.answers.length) // stable: ties keep model order
    .map((g, i) => ({ id: `g${i + 1}`, label: g.label, answers: g.answers }));

  logLine('claude', list.length, groups.length, Date.now() - started);
  return tag(groups, 'claude');
}

function buildUserPrompt(question, answers) {
  const lines = answers.map((a, i) => `${i}: ${String(a?.text ?? '').trim()}`);
  return [
    `Question: ${String(question ?? '').trim() || '(none)'}`,
    '',
    'Answers, one per line as "index: text":',
    ...lines,
    '',
    `Group these ${answers.length} answers by meaning. Return each group's members as the`,
    'INDEXES above — never the answer text. Every index from 0 to',
    `${answers.length - 1} must appear in exactly one group.`,
  ].join('\n');
}

function validatePartition(parsed, count) {
  const groups = parsed?.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new GroupingError('validation', 'response had no groups array');
  }

  const seen = new Set();
  const out = [];

  for (const g of groups) {
    if (!g || typeof g !== 'object') {
      throw new GroupingError('validation', 'group was not an object');
    }
    if (typeof g.label !== 'string') {
      throw new GroupingError('validation', 'group label was not a string');
    }
    if (!Array.isArray(g.members)) {
      throw new GroupingError('validation', 'group members was not an array');
    }
    for (const idx of g.members) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
        throw new GroupingError('validation', `member index ${idx} is out of range 0..${count - 1}`);
      }
      if (seen.has(idx)) {
        throw new GroupingError('validation', `member index ${idx} appeared in more than one group`);
      }
      seen.add(idx);
    }
    if (g.members.length > 0) out.push(g); // silently drop empty groups
  }

  if (seen.size !== count) {
    const missing = [];
    for (let i = 0; i < count; i += 1) if (!seen.has(i)) missing.push(i);
    throw new GroupingError('validation', `answers missing from partition: ${missing.join(', ')}`);
  }
  if (out.length === 0) {
    throw new GroupingError('validation', 'every group was empty');
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Deterministic fallback
 * ------------------------------------------------------------------ */

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Deterministic, dependency-free clustering. Exact normalized match first, then
 * merge buckets whose representatives are within Levenshtein distance 2
 * (for representatives of length >= 4). Largest group first. Never throws.
 *
 * @param {string} _question unused — kept for signature parity with groupAnswers
 * @param {Answer[]} answers
 * @returns {Group[]}
 */
export function fuzzyGroup(_question, answers) {
  const list = Array.isArray(answers) ? answers : [];
  const started = Date.now();

  // Pass 1: exact normalized match, first-seen order.
  /** @type {Map<string, { key: string, answers: Answer[] }>} */
  const buckets = new Map();
  for (const a of list) {
    const key = normalize(a?.text);
    const bucket = buckets.get(key);
    if (bucket) bucket.answers.push(a);
    else buckets.set(key, { key, answers: [a] });
  }

  // Pass 2: merge near-identical representatives (typos).
  /** @type {{ key: string, answers: Answer[] }[]} */
  const merged = [];
  for (const bucket of buckets.values()) {
    const target = merged.find((m) => closeEnough(m.key, bucket.key));
    if (target) target.answers.push(...bucket.answers);
    else merged.push({ key: bucket.key, answers: [...bucket.answers] });
  }

  const groups = merged
    .map((g) => ({ label: mostCommonLabel(g.answers), answers: g.answers }))
    .sort((a, b) => b.answers.length - a.answers.length) // stable: ties keep first-seen order
    .map((g, i) => ({ id: `g${i + 1}`, label: g.label, answers: g.answers }));

  logLine('fallback', list.length, groups.length, Date.now() - started);
  return tag(groups, 'fallback');
}

/**
 * Claude path with automatic fallback, for engines that would rather not try/catch.
 * @param {string} question
 * @param {Answer[]} answers
 * @returns {Promise<{ groups: Group[], source: 'claude'|'fallback', error: GroupingError|null }>}
 */
export async function groupAnswersWithFallback(question, answers) {
  try {
    return { groups: await groupAnswers(question, answers), source: 'claude', error: null };
  } catch (err) {
    const error = err instanceof GroupingError
      ? err
      : new GroupingError('api', String(err?.message ?? err), { cause: err });
    return { groups: fuzzyGroup(question, answers), source: 'fallback', error };
  }
}

/* ------------------------------------------------------------------ *
 * Normalization helpers (exported for tests; not part of the engine contract)
 * ------------------------------------------------------------------ */

/** lowercase, strip diacritics/punctuation, collapse whitespace, drop leading articles + plural 's'. */
export function normalize(text) {
  const flat = String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!flat) return '';

  const words = flat.split(' ');
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.map(depluralize).join(' ');
}

function depluralize(word) {
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Iterative Levenshtein, rolling two rows. No recursion, no deps. */
export function levenshtein(a, b) {
  const s = String(a ?? '');
  const t = String(b ?? '');
  if (s === t) return 0;
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;

  let prev = new Array(t.length + 1);
  let curr = new Array(t.length + 1);
  for (let j = 0; j <= t.length; j += 1) prev[j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    curr[0] = i;
    const sc = s.charCodeAt(i - 1);
    for (let j = 1; j <= t.length; j += 1) {
      const cost = sc === t.charCodeAt(j - 1) ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }
  return prev[t.length];
}

function closeEnough(a, b) {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshtein(a, b) <= 2;
}

/* ------------------------------------------------------------------ *
 * Labels + logging
 * ------------------------------------------------------------------ */

function mostCommonLabel(answers) {
  const counts = new Map();
  for (const a of answers) {
    const text = String(a?.text ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [text, count] of counts) {
    if (count > bestCount) {
      best = text;
      bestCount = count;
    }
  }
  return titleCase(best) || '(blank)';
}

function cleanLabel(label, fallbackText) {
  const clean = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (clean) return clean;
  return titleCase(String(fallbackText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)) || '(blank)';
}

function titleCase(text) {
  return String(text ?? '')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

// One concise line per grouping call. No secrets, no answer text.
function logLine(source, answerCount, groupCount, elapsedMs) {
  console.log(
    `[grouping] source=${source} answers=${answerCount} groups=${groupCount} ms=${elapsedMs}`,
  );
}

// Non-enumerable provenance marker, so a caller that ignores it still sees a plain array.
function tag(groups, source) {
  Object.defineProperty(groups, 'source', { value: source, enumerable: false });
  return groups;
}

function isAbort(err) {
  return err?.name === 'AbortError' || err?.name === 'TimeoutError' || err?.name === 'APIUserAbortError';
}
