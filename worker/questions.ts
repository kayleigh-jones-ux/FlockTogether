/* The question bank.
 *
 * src/questions.js is a file, which was right when the game only ran from a
 * checkout: editing a question meant editing the pack and restarting. On
 * Workers there is no checkout to edit and no restart to do, so the bank lives
 * in a Durable Object and the file becomes the SEED — the pack a fresh bank
 * starts from, and the thing "Reset to the shipped pack" restores.
 *
 * One object, not one per room. Questions are the property of the game rather
 * than of a party, so every room reads the same bank and an edit made between
 * rounds is live for the next room that asks. This is the one legitimate use of
 * a single global Durable Object in this codebase: it is a small, rarely
 * written, frequently read document, not a coordination point.
 *
 * It owns three things now:
 *   - the MAIN BANK        (questions where set_id IS NULL)
 *   - CUSTOM SETS          (a `sets` row + its own questions, set_id = the set)
 *   - SETTINGS             (the default answer time, in `settings`)
 * A game resolves through resolveGame(): a room hands it a set code (or none)
 * and gets back the exact ordered list it will ask, timers included.
 */

import { DurableObject } from 'cloudflare:workers';
import SEED from '../src/questions.js';

export interface Question {
  id: string;
  text: string;
  /** Seconds to answer, or null to use the room's default. */
  seconds: number | null;
  enabled: boolean;
}

/** How a custom set decides which of its questions a game asks. */
export type SetMode = 'all' | 'random';

export interface QuestionSet {
  id: string;
  /** The 6-char code a host types on the TV to arm this set. */
  code: string;
  name: string;
  mode: SetMode;
  /** For mode 'random': how many questions to pull each game. */
  count: number;
  /** How many usable (non-blank) questions the set holds right now. */
  size: number;
}

/** One question resolved for a game — text plus its own timer, or null. */
export interface ResolvedQuestion {
  text: string;
  seconds: number | null;
}

export interface ResolvedGame {
  questions: ResolvedQuestion[];
  pack: { code: string; name: string; size: number } | null;
}

/**
 * One question's identity for the purposes of "have we just asked this?".
 *
 * EXPORTED, and imported by room.ts rather than re-typed there, because it is
 * one half of a comparison whose two halves live in different objects: a room
 * remembers what it asked, the bank decides what to ask next, and the two must
 * agree on when two questions are the same question. Two copies of this rule
 * would agree on the day they were written and drift the first time either was
 * touched — and the symptom of that drift is a rematch quietly asking the same
 * nine questions again, which is precisely what nobody would notice was a bug.
 *
 * Whitespace and case only. Nothing cleverer: a question the editor genuinely
 * rewrote is a different question and SHOULD come back around.
 */
export function normalizeQuestionText(text: string): string {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

/* A question has to set huge on a shared display and be answerable with one
   thumb, so length is a product rule rather than a storage limit. The editor
   warns well before this; the server refuses past it. */
const MAX_TEXT = 140;
const MIN_SECONDS = 5;
const MAX_SECONDS = 300;

/* A game never asks more than this many questions no matter how large a set is:
   a party has a ceiling, and an accidental 500-question "all in order" set must
   not run until the room walks out. */
const MAX_GAME_QUESTIONS = 100;

/* Codes are read aloud off a TV and typed on a phone, so the alphabet drops
   every glyph that gets misread: no O, 0, I, 1 or L. Same alphabet as the room
   codes; six characters instead of four so the two are never confused and the
   space is large enough to type by hand without collisions. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const CODE_RE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/;

const SETTING_ANSWER_SECONDS = 'answer_seconds';

/* The index signature is required by sql.exec<T>: it hands back rows keyed by
   column name, so T has to admit arbitrary string keys as well as the ones
   named here. */
interface Row {
  [column: string]: SqlStorageValue;
  id: string;
  text: string;
  seconds: number | null;
  enabled: number;
  sort: number;
}

interface SetRow {
  [column: string]: SqlStorageValue;
  id: string;
  code: string;
  name: string;
  mode: string;
  count: number;
  sort: number;
}

export class QuestionBank extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.#migrate());
  }

  #migrate(): void {
    const sql = this.ctx.storage.sql;
    /* PRAGMA user_version is unavailable on Durable Object SQLite, so the
       applied versions are a table like everyone else's. */
    sql.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    const at = sql
      .exec<{ v: number }>('SELECT COALESCE(MAX(id), 0) AS v FROM _migrations')
      .one().v;

    if (at < 1) {
      sql.exec(`CREATE TABLE IF NOT EXISTS questions (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        seconds INTEGER,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL
      )`);
      sql.exec('INSERT INTO _migrations (id) VALUES (1)');
    }

    if (at < 2) {
      /* Custom sets and their standalone question lists. A set's questions live
         in the same `questions` table, distinguished by set_id; the main bank
         is exactly the rows where set_id IS NULL, so every existing question
         belongs to it untouched. */
      sql.exec(`CREATE TABLE IF NOT EXISTS sets (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'all',
        count INTEGER NOT NULL DEFAULT 10,
        sort INTEGER NOT NULL
      )`);
      sql.exec('ALTER TABLE questions ADD COLUMN set_id TEXT');
      sql.exec(`CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      sql.exec('INSERT INTO _migrations (id) VALUES (2)');
    }

    /* Seed only an empty MAIN BANK. Re-seeding a bank someone has edited would
       throw their work away every time the object woke up. */
    const count = sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE set_id IS NULL')
      .one().n;
    if (count === 0) this.#seed();
  }

  #seed(): void {
    const sql = this.ctx.storage.sql;
    const pack: string[] = Array.isArray(SEED) ? SEED : [];
    pack.forEach((text, i) => {
      sql.exec(
        'INSERT INTO questions (id, text, seconds, enabled, sort, set_id) VALUES (?, ?, NULL, 1, ?, NULL)',
        crypto.randomUUID(),
        String(text),
        i,
      );
    });
  }

  /* --------------------------------------------------------------- questions */

  /** Rows for the main bank (setId null) or one set, in editor order. */
  #rows(setId: string | null): Question[] {
    const sql = this.ctx.storage.sql;
    const cursor = setId
      ? sql.exec<Row>(
          'SELECT id, text, seconds, enabled, sort FROM questions WHERE set_id = ? ORDER BY sort, rowid',
          setId,
        )
      : sql.exec<Row>(
          'SELECT id, text, seconds, enabled, sort FROM questions WHERE set_id IS NULL ORDER BY sort, rowid',
        );
    return cursor.toArray().map((r) => ({
      id: r.id,
      text: r.text,
      seconds: r.seconds === null ? null : Number(r.seconds),
      enabled: r.enabled !== 0,
    }));
  }

  /**
   * List questions for the main bank, or a set when `setId` is given.
   * `seedSize` is only meaningful for the main bank; it is 0 for a set.
   */
  async list(setId?: string | null): Promise<{ questions: Question[]; seedSize: number }> {
    const id = setId ?? null;
    if (id && !this.#setExists(id)) return { questions: [], seedSize: 0 };
    return {
      questions: this.#rows(id),
      seedSize: id ? 0 : Array.isArray(SEED) ? SEED.length : 0,
    };
  }

  /**
   * Replace the whole list for the main bank, or one set. The editor sends the
   * full list rather than a diff: it is a small number of short rows, one
   * writer, and a whole-document write cannot half-apply the way a sequence of
   * patches can.
   *
   * The "at least one enabled" rule holds for the MAIN BANK only — a game with
   * no default questions has nothing to ask. A custom set may legitimately be
   * saved empty or all-off while it is being built; resolveGame refuses to
   * start a game on it, which is the right place for that check.
   */
  async replaceAll(
    input: unknown,
    setId?: string | null,
  ): Promise<{ ok: true; count: number } | { error: string }> {
    const id = setId ?? null;
    if (id && !this.#setExists(id)) return { error: 'That set no longer exists.' };
    if (!Array.isArray(input)) return { error: 'Expected a list of questions.' };
    if (input.length > 500) return { error: 'That is more than 500 questions.' };

    /* id is the PRIMARY KEY of a single table shared by every list, so an id
       reused within this payload, or one belonging to a DIFFERENT list, would
       abort the INSERT loop below on a constraint error. Both are regenerated
       up front so the save can never half-apply. Ids in THIS list are fine —
       their rows are deleted before the re-insert. */
    const foreign = new Set<string>();
    for (const r of this.ctx.storage.sql
      .exec<{ id: string; set_id: string | null }>('SELECT id, set_id FROM questions')
      .toArray()) {
      if ((r.set_id ?? null) !== id) foreign.add(r.id);
    }

    const seen = new Set<string>();
    const clean: Question[] = [];
    for (const raw of input) {
      const item = raw as Partial<Question>;
      const text = String(item?.text ?? '').trim();
      if (!text) continue; // a blank row is a deletion, not an error
      if (text.length > MAX_TEXT) {
        return { error: `"${text.slice(0, 40)}…" is longer than ${MAX_TEXT} characters.` };
      }

      let seconds: number | null = null;
      if (item?.seconds !== null && item?.seconds !== undefined && `${item.seconds}` !== '') {
        const n = Math.round(Number(item.seconds));
        if (!Number.isFinite(n) || n < MIN_SECONDS || n > MAX_SECONDS) {
          return { error: `"${text.slice(0, 40)}…" has a timer outside ${MIN_SECONDS}-${MAX_SECONDS}s.` };
        }
        seconds = n;
      }

      let qid = typeof item?.id === 'string' && item.id ? item.id : crypto.randomUUID();
      if (seen.has(qid) || foreign.has(qid)) qid = crypto.randomUUID();
      seen.add(qid);

      clean.push({ id: qid, text, seconds, enabled: item?.enabled !== false });
    }

    if (!id && !clean.some((q) => q.enabled)) {
      return { error: 'At least one question has to be switched on, or a game has nothing to ask.' };
    }

    /* No await between these, so they commit as one transaction: a bank can
       never be observed emptied but not yet refilled. */
    const sql = this.ctx.storage.sql;
    if (id) sql.exec('DELETE FROM questions WHERE set_id = ?', id);
    else sql.exec('DELETE FROM questions WHERE set_id IS NULL');
    clean.forEach((q, i) => {
      sql.exec(
        'INSERT INTO questions (id, text, seconds, enabled, sort, set_id) VALUES (?, ?, ?, ?, ?, ?)',
        q.id,
        q.text,
        q.seconds,
        q.enabled ? 1 : 0,
        i,
        id,
      );
    });

    return { ok: true, count: clean.length };
  }

  /** Throw away every edit to the MAIN BANK and go back to src/questions.js. */
  async resetToSeed(): Promise<{ ok: true; count: number }> {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM questions WHERE set_id IS NULL');
    this.#seed();
    return {
      ok: true,
      count: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM questions WHERE set_id IS NULL').one().n,
    };
  }

  /* -------------------------------------------------------------- settings */

  /** The saved default answer time, or null when it has never been set. */
  async getSettings(): Promise<{ answerSeconds: number | null }> {
    return { answerSeconds: this.#answerSeconds() };
  }

  #answerSeconds(): number | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>('SELECT value FROM settings WHERE key = ?', SETTING_ANSWER_SECONDS)
      .toArray()[0];
    if (!row) return null;
    const n = Number(row.value);
    return Number.isFinite(n) ? n : null;
  }

  /** Set (or clear, with null) the default answer time all questions inherit. */
  async setSetting(input: unknown): Promise<{ ok: true; answerSeconds: number | null } | { error: string }> {
    const raw = (input as { answerSeconds?: unknown })?.answerSeconds;
    const sql = this.ctx.storage.sql;

    if (raw === null || raw === undefined || `${raw}` === '') {
      sql.exec('DELETE FROM settings WHERE key = ?', SETTING_ANSWER_SECONDS);
      return { ok: true, answerSeconds: null };
    }
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n < MIN_SECONDS || n > MAX_SECONDS) {
      return { error: `The default time has to be between ${MIN_SECONDS} and ${MAX_SECONDS} seconds.` };
    }
    sql.exec(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      SETTING_ANSWER_SECONDS,
      String(n),
    );
    return { ok: true, answerSeconds: n };
  }

  /* ------------------------------------------------------------------ sets */

  #setExists(id: string): boolean {
    return (
      this.ctx.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM sets WHERE id = ?', id).one().n > 0
    );
  }

  #setSize(id: string): number {
    return this.ctx.storage.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM questions WHERE set_id = ? AND enabled != 0 AND TRIM(text) != ''",
        id,
      )
      .one().n;
  }

  #setRowToPublic(r: SetRow): QuestionSet {
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      mode: r.mode === 'random' ? 'random' : 'all',
      count: Number(r.count),
      size: this.#setSize(r.id),
    };
  }

  /** Every custom set, in creation order. */
  async listSets(): Promise<QuestionSet[]> {
    return this.ctx.storage.sql
      .exec<SetRow>('SELECT id, code, name, mode, count, sort FROM sets ORDER BY sort, rowid')
      .toArray()
      .map((r) => this.#setRowToPublic(r));
  }

  #uniqueCode(): string {
    const sql = this.ctx.storage.sql;
    const free = (code: string) =>
      sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM sets WHERE code = ?', code).one().n === 0;

    for (let attempt = 0; attempt < 30; attempt += 1) {
      const bytes = new Uint8Array(CODE_LENGTH);
      crypto.getRandomValues(bytes);
      let code = '';
      for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
      if (free(code)) return code;
    }
    /* Astronomically unlikely with a 30^6 space and a handful of sets. If we do
       get here, a deterministic sweep is guaranteed to find a free code while
       any remain, so createSet's UNIQUE(code) insert can never throw. */
    const base = CODE_ALPHABET.length;
    for (let n = 0; n < base ** CODE_LENGTH; n += 1) {
      let code = '';
      let x = n;
      for (let i = 0; i < CODE_LENGTH; i += 1) {
        code = CODE_ALPHABET[x % base]! + code;
        x = Math.floor(x / base);
      }
      if (free(code)) return code;
    }
    return CODE_ALPHABET.slice(0, CODE_LENGTH); // truly unreachable
  }

  /** Create an empty set with a generated, editable code. */
  async createSet(input?: unknown): Promise<QuestionSet> {
    const sql = this.ctx.storage.sql;
    const rawName = String((input as { name?: unknown })?.name ?? '').trim().slice(0, 60);
    const nextSort =
      sql.exec<{ v: number }>('SELECT COALESCE(MAX(sort), -1) + 1 AS v FROM sets').one().v;
    const name = rawName || `Set ${nextSort + 1}`;
    const id = crypto.randomUUID();
    const code = this.#uniqueCode();
    sql.exec(
      'INSERT INTO sets (id, code, name, mode, count, sort) VALUES (?, ?, ?, ?, ?, ?)',
      id,
      code,
      name,
      'all',
      10,
      nextSort,
    );
    return { id, code, name, mode: 'all', count: 10, size: 0 };
  }

  /** Rename a set, change its code, or change its mode/count. */
  async updateSetMeta(id: string, input: unknown): Promise<{ ok: true; set: QuestionSet } | { error: string }> {
    const sql = this.ctx.storage.sql;
    const current = sql
      .exec<SetRow>('SELECT id, code, name, mode, count, sort FROM sets WHERE id = ?', id)
      .toArray()[0];
    if (!current) return { error: 'That set no longer exists.' };

    const patch = (input ?? {}) as Partial<{ name: string; code: string; mode: string; count: number }>;

    let name = current.name;
    if (patch.name !== undefined) {
      name = String(patch.name).trim().slice(0, 60);
      if (!name) return { error: 'A set needs a name.' };
    }

    let code = current.code;
    if (patch.code !== undefined) {
      code = String(patch.code).trim().toUpperCase();
      if (!CODE_RE.test(code)) {
        return { error: 'A code is 6 characters using A–Z and 2–9 (no O, 0, I, 1 or L).' };
      }
      const clash = sql
        .exec<{ n: number }>('SELECT COUNT(*) AS n FROM sets WHERE code = ? AND id != ?', code, id)
        .one().n;
      if (clash > 0) return { error: 'Another set already uses that code.' };
    }

    let mode = current.mode === 'random' ? 'random' : 'all';
    if (patch.mode !== undefined) {
      if (patch.mode !== 'all' && patch.mode !== 'random') return { error: 'Unknown set mode.' };
      mode = patch.mode;
    }

    let count = Number(current.count);
    if (patch.count !== undefined) {
      const n = Math.round(Number(patch.count));
      if (!Number.isFinite(n) || n < 1 || n > MAX_GAME_QUESTIONS) {
        return { error: `The number of questions has to be between 1 and ${MAX_GAME_QUESTIONS}.` };
      }
      count = n;
    }

    sql.exec('UPDATE sets SET name = ?, code = ?, mode = ?, count = ? WHERE id = ?', name, code, mode, count, id);
    return {
      ok: true,
      set: { id, code, name, mode: mode as SetMode, count, size: this.#setSize(id) },
    };
  }

  /** Delete a set and all of its questions. */
  async deleteSet(id: string): Promise<{ ok: true } | { error: string }> {
    const sql = this.ctx.storage.sql;
    if (!this.#setExists(id)) return { error: 'That set no longer exists.' };
    sql.exec('DELETE FROM questions WHERE set_id = ?', id);
    sql.exec('DELETE FROM sets WHERE id = ?', id);
    return { ok: true };
  }

  /** A set by its typed code, for the TV to validate against. Null if none. */
  async packByCode(rawCode: string): Promise<{ id: string; name: string; size: number } | null> {
    const code = String(rawCode ?? '').trim().toUpperCase();
    if (!CODE_RE.test(code)) return null;
    const row = this.ctx.storage.sql
      .exec<SetRow>('SELECT id, code, name, mode, count, sort FROM sets WHERE code = ?', code)
      .toArray()[0];
    if (!row) return null;
    return { id: row.id, name: row.name, size: this.#setSize(row.id) };
  }

  /* --------------------------------------------------------- resolve a game */

  /** Fisher-Yates over a copy — random pick without repeats. */
  #sample<T>(list: T[], count: number): T[] {
    const pool = list.slice();
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    return pool.slice(0, Math.max(0, Math.min(count, pool.length)));
  }

  /* The bank has no idea which questions a given room has already been asked —
     that memory belongs to the room and arrives here as `avoid`, most recently
     asked FIRST. Matched on normalised TEXT (normalizeQuestionText, shared with
     room.ts) rather than on question id, and that is not laziness: a
     ResolvedQuestion carries no id (it never needed one), the room can only
     honestly remember what it put on the screen, and ids are regenerated by
     replaceAll whenever a list is pasted back in — so an id match would quietly
     stop matching the first time somebody edited the bank, which is the day a
     rematch silently starts repeating itself again. */

  /**
   * `count` questions from `pool`, preferring ones this room has not just been
   * asked. THE POINT OF THE WHOLE FILE'S CHANGE: a rematch that asks the same
   * nine questions is a rematch nobody wants.
   *
   * Fresh first, and only then a top-up from the STALEST end of the memory —
   * `avoid` is ordered most-recent-first, so the questions from three games ago
   * come back before the ones from the game that just finished. Falling back at
   * all is not optional: a nine-round game on a twelve-question set has to come
   * from somewhere, and a game that shrank to three rounds because the bank ran
   * dry would be a worse answer than a repeat. Freshness is a PREFERENCE, never
   * a filter that can starve a game.
   *
   * The combined list is shuffled at the end rather than returned fresh-then-
   * stale: otherwise every repeat lands predictably in the closing rounds, and
   * the room learns to read "we have run out" off the running order.
   */
  #pickFresh(pool: ResolvedQuestion[], count: number, avoid: string[]): ResolvedQuestion[] {
    const want = Math.max(0, Math.min(count, pool.length));
    if (want === 0) return [];
    if (avoid.length === 0) return this.#sample(pool, want);

    /* Position in `avoid` IS the staleness: 0 is the most recently asked. First
       occurrence wins, so a question asked in two different games counts as
       having been asked in the more recent one. */
    const askedAt = new Map<string, number>();
    avoid.forEach((text, i) => {
      const key = normalizeQuestionText(String(text ?? ''));
      if (key && !askedAt.has(key)) askedAt.set(key, i);
    });

    const fresh: ResolvedQuestion[] = [];
    const stale: ResolvedQuestion[] = [];
    for (const q of pool) (askedAt.has(normalizeQuestionText(q.text)) ? stale : fresh).push(q);

    const chosen = this.#sample(fresh, want);
    if (chosen.length < want) {
      /* Shuffle first, THEN sort by staleness descending. Array.prototype.sort
         is stable, so questions of equal staleness — the whole of one previous
         game, say — keep the shuffled order rather than always coming back in
         the same bank order. */
      const shuffled = this.#sample(stale, stale.length);
      shuffled.sort(
        (a, b) => (askedAt.get(normalizeQuestionText(b.text)) ?? 0) - (askedAt.get(normalizeQuestionText(a.text)) ?? 0),
      );
      chosen.push(...shuffled.slice(0, want - chosen.length));
    }
    return this.#sample(chosen, chosen.length);
  }

  #playableRows(setId: string | null): ResolvedQuestion[] {
    return this.#rows(setId)
      .filter((q) => q.enabled && q.text.trim())
      .map((q) => ({ text: q.text, seconds: q.seconds }));
  }

  /**
   * The exact ordered list a game will ask.
   *
   *  - No pack code: the main bank, a random sample of `defaultRounds`, as the
   *    Node server always did.
   *  - A pack code that matches a set: that set's usable questions. Mode 'all'
   *    runs every one in editor order; mode 'random' pulls `count` at random.
   *
   * The room resolves this ONCE at start and plays from the returned copy, so a
   * mid-game edit to the bank never changes the game in progress.
   *
   * `avoid` is what THIS ROOM has already been asked, most recent first, and it
   * arrives as an argument because the bank must not hold it. The bank is ONE
   * object shared by every party in the world: a "recently asked" list living
   * here would be every room's list at once, so the second paddock of the
   * evening would be handed the leftovers of a game played by strangers, and
   * two rooms starting at the same moment would fight over it. The memory is a
   * fact about a room, it is stored on the room record, and it is passed in.
   *
   * It is a PREFERENCE and never a filter — see #pickFresh — with one honest
   * exception: a set in mode 'all' asks every question it has, in editor order,
   * because that is what 'all' means. There is nothing to choose between, so
   * there is nothing freshness could do except make the second run shorter than
   * the first and eventually empty. `avoid` is ignored there, deliberately.
   */
  async resolveGame(
    packCode: string | null,
    defaultRounds: number,
    avoid?: string[],
  ): Promise<ResolvedGame> {
    /* Comes off a room record and through an RPC, so it is checked rather than
       trusted: a legacy record has no such field at all. */
    const recent = Array.isArray(avoid) ? avoid.filter((t): t is string => typeof t === 'string') : [];
    const code = String(packCode ?? '').trim().toUpperCase();
    if (code && CODE_RE.test(code)) {
      const row = this.ctx.storage.sql
        .exec<SetRow>('SELECT id, code, name, mode, count, sort FROM sets WHERE code = ?', code)
        .toArray()[0];
      if (row) {
        const usable = this.#playableRows(row.id);
        const mode = row.mode === 'random' ? 'random' : 'all';
        const chosen =
          mode === 'random'
            ? this.#pickFresh(usable, Number(row.count), recent)
            : usable.slice(0, MAX_GAME_QUESTIONS);
        return {
          questions: chosen.slice(0, MAX_GAME_QUESTIONS),
          pack: { code: row.code, name: row.name, size: usable.length },
        };
      }
      /* A code that matched nothing falls through to the main bank rather than
         producing an empty game; the TV validated it, so this is only reachable
         if the set was deleted between arming and starting. */
    }

    const bank = this.#playableRows(null);
    return { questions: this.#pickFresh(bank, defaultRounds, recent), pack: null };
  }
}
