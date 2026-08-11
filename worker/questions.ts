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

/* A question has to set huge on a shared display and be answerable with one
   thumb, so length is a product rule rather than a storage limit. The editor
   warns well before this; the server refuses past it. */
const MAX_TEXT = 140;
const MIN_SECONDS = 5;
const MAX_SECONDS = 300;

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

    /* Seed only an empty bank. Re-seeding a bank someone has edited would throw
       their work away every time the object woke up. */
    const count = sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM questions').one().n;
    if (count === 0) this.#seed();
  }

  #seed(): void {
    const sql = this.ctx.storage.sql;
    const pack: string[] = Array.isArray(SEED) ? SEED : [];
    pack.forEach((text, i) => {
      sql.exec(
        'INSERT INTO questions (id, text, seconds, enabled, sort) VALUES (?, ?, NULL, 1, ?)',
        crypto.randomUUID(),
        String(text),
        i,
      );
    });
  }

  #rows(): Question[] {
    return this.ctx.storage.sql
      .exec<Row>('SELECT id, text, seconds, enabled, sort FROM questions ORDER BY sort, rowid')
      .toArray()
      .map((r) => ({
        id: r.id,
        text: r.text,
        seconds: r.seconds === null ? null : Number(r.seconds),
        enabled: r.enabled !== 0,
      }));
  }

  async list(): Promise<{ questions: Question[]; seedSize: number }> {
    return { questions: this.#rows(), seedSize: Array.isArray(SEED) ? SEED.length : 0 };
  }

  /** What a game should draw from: enabled only, in order. */
  async playable(): Promise<Question[]> {
    return this.#rows().filter((q) => q.enabled && q.text.trim());
  }

  /**
   * Replace the whole bank. The editor sends the full list rather than a diff:
   * it is under a hundred short rows, one writer, and a whole-document write
   * cannot half-apply the way a sequence of patches can.
   */
  async replaceAll(input: unknown): Promise<{ ok: true; count: number } | { error: string }> {
    if (!Array.isArray(input)) return { error: 'Expected a list of questions.' };
    if (input.length > 500) return { error: 'That is more than 500 questions.' };

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

      clean.push({
        id: typeof item?.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        text,
        seconds,
        enabled: item?.enabled !== false,
      });
    }

    if (!clean.some((q) => q.enabled)) {
      return { error: 'At least one question has to be switched on, or a game has nothing to ask.' };
    }

    /* No await between these, so they commit as one transaction: a bank can
       never be observed emptied but not yet refilled. */
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM questions');
    clean.forEach((q, i) => {
      sql.exec(
        'INSERT INTO questions (id, text, seconds, enabled, sort) VALUES (?, ?, ?, ?, ?)',
        q.id,
        q.text,
        q.seconds,
        q.enabled ? 1 : 0,
        i,
      );
    });

    return { ok: true, count: clean.length };
  }

  /** Throw away every edit and go back to the pack in src/questions.js. */
  async resetToSeed(): Promise<{ ok: true; count: number }> {
    const sql = this.ctx.storage.sql;
    sql.exec('DELETE FROM questions');
    this.#seed();
    return { ok: true, count: sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM questions').one().n };
  }
}
