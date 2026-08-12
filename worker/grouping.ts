/* Semantic answer clustering for the Worker.
 *
 * A near-direct port of src/grouping.js, with one difference forced by the
 * runtime: credentials arrive as an argument, not off process.env. On Workers
 * the API key is a binding (env.ANTHROPIC_API_KEY), so the caller reads it and
 * hands it in. Everything else — the index-based schema that keeps the model
 * from rewording an answer, the strict partition check, the deterministic
 * fuzzy fallback — is the same contract the Node server ran.
 *
 * Two paths:
 *   groupAnswers(question, answers, apiKey)  -> Claude. THROWS on any failure.
 *   fuzzyGroup(question, answers)            -> deterministic. Never throws.
 * groupAnswersWithFallback() runs the first and falls back to the second,
 * reporting which one produced the result so the engine can label it honestly.
 */

export interface Answer {
  playerId: string;
  name: string;
  text: string;
}

export interface Group {
  id: string;
  label: string;
  answers: Answer[];
}

export type GroupingSource = 'claude' | 'fallback';

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

// Index-based output: the model returns positions in the answers array, never
// answer text. A hallucinated or reworded answer therefore cannot corrupt game
// state.
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
} as const;

/** Typed failure so the engine can tell a refusal from a timeout from bad output. */
export class GroupingError extends Error {
  kind: string;
  constructor(kind: string, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'GroupingError';
    this.kind = kind;
  }
}

/* ------------------------------------------------------------------ *
 * Claude path
 * ------------------------------------------------------------------ */

/**
 * Cluster answers by meaning using Claude. Largest group first. Throws on a
 * missing key, timeout, refusal, unparseable output, or a partition that does
 * not cover every answer exactly once.
 */
export async function groupAnswers(
  question: string,
  answers: Answer[],
  apiKey: string | undefined,
): Promise<Group[]> {
  const list = Array.isArray(answers) ? answers : [];
  if (list.length === 0) return [];

  if (!apiKey) throw new GroupingError('no_api_key', 'ANTHROPIC_API_KEY is not set');

  let Anthropic: unknown;
  try {
    const mod = await import('@anthropic-ai/sdk');
    Anthropic = (mod as { default?: unknown }).default ?? (mod as { Anthropic?: unknown }).Anthropic;
  } catch (cause) {
    throw new GroupingError('sdk_missing', '@anthropic-ai/sdk is not installed', { cause });
  }

  const Ctor = Anthropic as new (opts: Record<string, unknown>) => {
    messages: { create: (body: unknown, opts: unknown) => Promise<AnthropicResponse> };
  };
  const client = new Ctor({ apiKey, maxRetries: 1 });
  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);

  let response: AnthropicResponse;
  try {
    response = await client.messages.create(
      {
        model: MODEL,
        max_tokens: MAX_TOKENS,
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
    throw new GroupingError('api', `grouping call failed: ${errMessage(cause)}`, { cause });
  }

  if (response?.stop_reason === 'refusal') {
    throw new GroupingError('refusal', 'model refused to group answers');
  }

  const textBlock = (response?.content ?? []).find((b) => b?.type === 'text');
  if (!textBlock || typeof textBlock.text !== 'string' || !textBlock.text.trim()) {
    throw new GroupingError('no_text', 'response contained no text block');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlock.text);
  } catch (cause) {
    throw new GroupingError('parse', 'response text was not valid JSON', { cause });
  }

  const raw = validatePartition(parsed, list.length);
  return raw
    .map((g) => ({
      // validatePartition has already proven every index is in range 0..len-1.
      label: cleanLabel(g.label, list[g.members[0]!]?.text),
      answers: g.members.map((i) => list[i]!),
    }))
    .sort((a, b) => b.answers.length - a.answers.length)
    .map((g, i) => ({ id: `g${i + 1}`, label: g.label, answers: g.answers }));
}

interface AnthropicResponse {
  stop_reason?: string;
  content?: Array<{ type?: string; text?: string }>;
}

function buildUserPrompt(question: string, answers: Answer[]): string {
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

interface RawGroup {
  label: string;
  members: number[];
}

function validatePartition(parsed: unknown, count: number): RawGroup[] {
  const groups = (parsed as { groups?: unknown })?.groups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new GroupingError('validation', 'response had no groups array');
  }

  const seen = new Set<number>();
  const out: RawGroup[] = [];

  for (const g of groups) {
    if (!g || typeof g !== 'object') throw new GroupingError('validation', 'group was not an object');
    const label = (g as { label?: unknown }).label;
    const members = (g as { members?: unknown }).members;
    if (typeof label !== 'string') throw new GroupingError('validation', 'group label was not a string');
    if (!Array.isArray(members)) throw new GroupingError('validation', 'group members was not an array');
    for (const idx of members) {
      if (!Number.isInteger(idx) || idx < 0 || idx >= count) {
        throw new GroupingError('validation', `member index ${idx} is out of range 0..${count - 1}`);
      }
      if (seen.has(idx)) {
        throw new GroupingError('validation', `member index ${idx} appeared in more than one group`);
      }
      seen.add(idx);
    }
    if (members.length > 0) out.push({ label, members });
  }

  if (seen.size !== count) {
    throw new GroupingError('validation', 'partition did not cover every answer');
  }
  if (out.length === 0) throw new GroupingError('validation', 'every group was empty');
  return out;
}

/* ------------------------------------------------------------------ *
 * Deterministic fallback
 * ------------------------------------------------------------------ */

const ARTICLES = new Set(['a', 'an', 'the']);

/**
 * Deterministic, dependency-free clustering. Exact normalized match, then merge
 * buckets whose representatives are within Levenshtein distance 2. Largest
 * group first. Never throws.
 */
export function fuzzyGroup(_question: string, answers: Answer[]): Group[] {
  const list = Array.isArray(answers) ? answers : [];

  const buckets = new Map<string, { key: string; answers: Answer[] }>();
  for (const a of list) {
    const key = normalize(a?.text);
    const bucket = buckets.get(key);
    if (bucket) bucket.answers.push(a);
    else buckets.set(key, { key, answers: [a] });
  }

  const merged: { key: string; answers: Answer[] }[] = [];
  for (const bucket of buckets.values()) {
    const target = merged.find((m) => closeEnough(m.key, bucket.key));
    if (target) target.answers.push(...bucket.answers);
    else merged.push({ key: bucket.key, answers: [...bucket.answers] });
  }

  return merged
    .map((g) => ({ label: mostCommonLabel(g.answers), answers: g.answers }))
    .sort((a, b) => b.answers.length - a.answers.length)
    .map((g, i) => ({ id: `g${i + 1}`, label: g.label, answers: g.answers }));
}

/** Claude path with automatic fallback. */
export async function groupAnswersWithFallback(
  question: string,
  answers: Answer[],
  apiKey: string | undefined,
): Promise<{ groups: Group[]; source: GroupingSource }> {
  try {
    return { groups: await groupAnswers(question, answers, apiKey), source: 'claude' };
  } catch {
    return { groups: fuzzyGroup(question, answers), source: 'fallback' };
  }
}

/* ------------------------------------------------------------------ *
 * Normalization helpers
 * ------------------------------------------------------------------ */

export function normalize(text: string | undefined): string {
  const flat = String(text ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // combining marks (diacritics)
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!flat) return '';
  const words = flat.split(' ');
  while (words.length > 1 && ARTICLES.has(words[0]!)) words.shift();
  return words.map(depluralize).join(' ');
}

function depluralize(word: string): string {
  if (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function levenshtein(a: string, b: string): number {
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

function closeEnough(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (Math.abs(a.length - b.length) > 2) return false;
  return levenshtein(a, b) <= 2;
}

function mostCommonLabel(answers: Answer[]): string {
  const counts = new Map<string, number>();
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

function cleanLabel(label: string | undefined, fallbackText: string | undefined): string {
  const clean = String(label ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
  if (clean) return clean;
  return titleCase(String(fallbackText ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)) || '(blank)';
}

function titleCase(text: string): string {
  return String(text ?? '')
    .split(' ')
    .filter(Boolean)
    .map((w) => (w === w.toUpperCase() ? w : w[0]!.toUpperCase() + w.slice(1).toLowerCase()))
    .join(' ');
}

function isAbort(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'AbortError' || name === 'TimeoutError' || name === 'APIUserAbortError';
}

function errMessage(err: unknown): string {
  return (err as { message?: string })?.message ?? String(err);
}
