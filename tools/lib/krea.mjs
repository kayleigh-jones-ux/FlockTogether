/* Minimal Krea API client — only the four calls the asset script needs.
 *
 * Contract verified live against https://api.krea.ai/openapi.json on
 * 2026-08-11, not from memory:
 *   POST /assets                            multipart -> { id, image_url }
 *   POST /generate/image/krea/krea-2/large  json      -> { job_id, status }
 *   GET  /jobs/{id}                                   -> { status, result }
 *   GET  <result url>                                 -> the image bytes
 *
 * Generation is asynchronous: the POST returns a queued job and the image only
 * exists once /jobs/{id} reports `completed`. Note that `intermediate-complete`
 * is NOT terminal — a preview is ready but the final image is not, so treating
 * it as done would download a half-sampled image.
 */

import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

export const KREA_BASE = 'https://api.krea.ai';
export const MODEL_PATH = '/generate/image/krea/krea-2/large';

/** Terminal job states. Anything else means keep polling. */
const DONE = new Set(['completed', 'failed', 'cancelled']);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class KreaError extends Error {
  constructor(message, { status, body, retryable = false } = {}) {
    super(message);
    this.name = 'KreaError';
    this.status = status;
    this.body = body;
    this.retryable = retryable;
  }
}

export class Krea {
  /**
   * @param {string} apiKey
   * @param {object} [opts]
   * @param {(msg: string) => void} [opts.log]
   */
  constructor(apiKey, opts = {}) {
    if (!apiKey) throw new KreaError('No API key given.');
    this.apiKey = apiKey;
    this.log = opts.log || (() => {});
  }

  get #auth() {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  /**
   * One HTTP call with retry on the failures that are actually transient:
   * 429 (concurrent-job cap), 5xx, and network errors. A 400/401/402 is a
   * standing condition — retrying a bad prompt or an empty wallet just burns
   * time, so those throw immediately.
   */
  async #request(path, init = {}, { attempts = 5, label = path } = {}) {
    let wait = 2000;
    for (let attempt = 1; ; attempt++) {
      let res;
      try {
        res = await fetch(`${KREA_BASE}${path}`, init);
      } catch (cause) {
        if (attempt >= attempts) {
          throw new KreaError(`${label}: network error after ${attempts} tries: ${cause.message}`);
        }
        this.log(`${label}: network error, retrying in ${wait / 1000}s`);
        await sleep(wait);
        wait = Math.min(wait * 2, 30000);
        continue;
      }

      if (res.ok) return res.json();

      const body = await res.text().catch(() => '');
      const retryable = res.status === 429 || res.status >= 500;

      if (!retryable) {
        const hint =
          res.status === 401
            ? ' — check KREA_API_KEY'
            : res.status === 402
              ? ' — out of Krea credits'
              : '';
        throw new KreaError(`${label}: HTTP ${res.status}${hint}: ${body.slice(0, 300)}`, {
          status: res.status,
          body,
        });
      }

      if (attempt >= attempts) {
        throw new KreaError(`${label}: HTTP ${res.status} after ${attempts} tries: ${body.slice(0, 200)}`, {
          status: res.status,
          body,
          retryable: true,
        });
      }

      // Honour Retry-After when the server sends one, else exponential backoff.
      const after = Number(res.headers.get('retry-after'));
      const delay = Number.isFinite(after) && after > 0 ? after * 1000 : wait;
      this.log(
        `${label}: HTTP ${res.status} (${res.status === 429 ? 'busy' : 'server error'}), retrying in ${Math.round(delay / 1000)}s`,
      );
      await sleep(delay);
      wait = Math.min(wait * 2, 30000);
    }
  }

  /**
   * Upload a local image so it can be used as a style reference.
   *
   * This exists because `image_style_references[].url` is capped at 1024
   * characters, which a base64 data URI of any real image blows past — so a
   * local file has to become a hosted asset URL first.
   *
   * @param {string} filePath
   * @param {string} [description]
   * @returns {Promise<{id: string, image_url: string}>}
   */
  async uploadAsset(filePath, description = '') {
    const form = new FormData();
    // Stream rather than read whole: these are small, but the API accepts up to
    // 75MB and there is no reason to hold that in memory.
    const file = await fileFromPath(filePath);
    form.append('file', file, basename(filePath));
    if (description) form.append('description', description);

    return this.#request(
      '/assets',
      { method: 'POST', headers: this.#auth, body: form },
      { label: `upload ${basename(filePath)}` },
    );
  }

  /**
   * Submit a text-to-image job. Returns as soon as the job is queued.
   * @param {object} body Request body matching the krea-2/large schema.
   */
  async submit(body) {
    const job = await this.#request(
      MODEL_PATH,
      {
        method: 'POST',
        headers: { ...this.#auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      { label: 'submit' },
    );
    if (!job?.job_id) throw new KreaError(`submit: no job_id in response: ${JSON.stringify(job)}`);
    return job;
  }

  /**
   * Poll a job until it reaches a terminal state.
   * @returns {Promise<object>} the completed job
   */
  async wait(jobId, { intervalMs = 2500, timeoutMs = 420000, label = jobId.slice(0, 8) } = {}) {
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      const job = await this.#request(`/jobs/${jobId}`, { headers: this.#auth }, { label: `poll ${label}` });
      if (job.status !== last) {
        this.log(`${label}: ${job.status}`);
        last = job.status;
      }
      if (DONE.has(job.status)) {
        if (job.status !== 'completed') {
          throw new KreaError(
            `${label}: job ${job.status}${job.error ? `: ${job.error.code} ${job.error.message ?? ''}` : ''}`,
            { body: job },
          );
        }
        return job;
      }
      if (Date.now() > deadline) {
        throw new KreaError(`${label}: still "${job.status}" after ${Math.round(timeoutMs / 1000)}s, giving up`);
      }
      await sleep(intervalMs);
    }
  }

  /**
   * Pull the first image URL out of a completed job.
   *
   * `result.urls` is polymorphic in the schema — a string array, an array of
   * {type,url} (3D models return model/preview pairs), or an object map — so
   * all three shapes are handled rather than assuming the common one.
   */
  static firstUrl(job) {
    const urls = job?.result?.urls;
    if (!urls) return null;
    if (Array.isArray(urls)) {
      const first = urls[0];
      if (!first) return null;
      return typeof first === 'string' ? first : (first.url ?? null);
    }
    if (typeof urls === 'object') {
      const vals = Object.values(urls).filter((v) => typeof v === 'string');
      return vals[0] ?? null;
    }
    return null;
  }

  /** Download bytes from a result URL. */
  async download(url, { attempts = 4 } = {}) {
    let wait = 1500;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return Buffer.from(await res.arrayBuffer());
      } catch (cause) {
        if (attempt >= attempts) throw new KreaError(`download failed: ${cause.message}`);
        await sleep(wait);
        wait *= 2;
      }
    }
  }

  /** Submit, wait, and download in one step. */
  async generate(body, { label } = {}) {
    const queued = await this.submit(body);
    const job = await this.wait(queued.job_id, { label: label || queued.job_id.slice(0, 8) });
    const url = Krea.firstUrl(job);
    if (!url) throw new KreaError(`${label}: completed with no image URL`);
    return { bytes: await this.download(url), job, url };
  }
}

/** Build a File for FormData from a path, streaming the body. */
async function fileFromPath(path) {
  const { openAsBlob } = await import('node:fs');
  if (typeof openAsBlob === 'function') {
    // Node 20+: hands FormData a lazily-read Blob.
    return openAsBlob(path);
  }
  // Fallback: buffer it.
  const chunks = [];
  for await (const c of createReadStream(path)) chunks.push(c);
  return new Blob([Buffer.concat(chunks)]);
}

export default { Krea, KreaError, KREA_BASE, MODEL_PATH };
