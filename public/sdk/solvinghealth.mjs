// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Blaine Warkentine. Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
/**
 * SolvingHealth Public Data API — JavaScript SDK
 *
 *   import { SolvingHealth } from 'https://solvinghealth.com/sdk/solvinghealth.mjs';
 *   const sh = new SolvingHealth();
 *   const { results } = await sh.providers.search({ state: 'CO', taxonomy: 'Orthopaedic Surgery' });
 *
 * Zero dependencies. Runs in a browser, in Node 18+, in Deno, and in a worker.
 * No key required — the API is read-only public federal data and holds no PHI.
 *
 * Every response carries `source`, `source_url` and `retrieved_at`, so any fact
 * you get back can be re-derived from the government source without trusting us.
 */

export const VERSION = '1.1.0';
const DEFAULT_BASE = 'https://solvinghealth.com/api/v1';

/**
 * NPI check digit (the Luhn formula over the NPI with the 80840 health-industry prefix, as CMS
 * specifies for the NPI). A pass means the number is well formed, not that it is assigned to anyone:
 * look it up in NPPES for that. Runs locally; no network call.
 * @param {string|number} npi
 * @returns {{ valid: boolean, npi: string, reason: string | null }}
 */
export function verifyNpiLuhn(npi) {
  const clean = String(npi ?? '').trim();
  if (!/^\d{10}$/.test(clean)) return { valid: false, npi: clean, reason: 'An NPI is exactly 10 digits.' };
  const d = clean.split('').map(Number);
  let sum = 24; // the prefix 80840 contributes 24 under the Luhn doubling
  for (let i = 8; i >= 0; i--) {
    let x = d[i];
    if ((8 - i) % 2 === 0) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  const expected = (10 - (sum % 10)) % 10;
  return expected === d[9]
    ? { valid: true, npi: clean, reason: null }
    : { valid: false, npi: clean, reason: `Check digit mismatch (expected ${expected}, got ${d[9]}).` };
}

/**
 * Line-by-line difference between an AI draft and the text a clinician signed: which lines were kept,
 * struck and added. Lines are trimmed and blank lines ignored. Runs locally; no network call.
 * @param {string} [draftText]
 * @param {string} [signedText]
 * @returns {{ kept: string[], struck: string[], added: string[], changed: boolean }}
 */
export function computeLineDelta(draftText = '', signedText = '') {
  const lines = (s) => String(s ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const draft = lines(draftText), signed = lines(signedText);
  const inDraft = new Set(draft), inSigned = new Set(signed);
  const kept = signed.filter((l) => inDraft.has(l));
  const struck = draft.filter((l) => !inSigned.has(l));
  const added = signed.filter((l) => !inDraft.has(l));
  return { kept, struck, added, changed: struck.length > 0 || added.length > 0 };
}

/** Thrown for any non-2xx response. Carries the API's structured error. */
export class SolvingHealthError extends Error {
  constructor(status, body, url) {
    super(`[${status}] ${body?.error || 'request_failed'}${body?.detail ? ': ' + body.detail : ''}`);
    this.name = 'SolvingHealthError';
    this.status = status;
    this.code = body?.error || 'request_failed';
    this.detail = body?.detail || null;
    this.url = url;
    this.body = body;
  }
  /** True when retrying later could plausibly succeed. */
  get retryable() {
    return this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class SolvingHealth {
  /**
   * @param {object} [opts]
   * @param {string} [opts.baseUrl]  Override the base URL.
   * @param {number} [opts.timeout]  Per-request timeout in ms (default 15000).
   * @param {number} [opts.retries]  Retries for retryable failures (default 2).
   * @param {typeof fetch} [opts.fetch] Custom fetch implementation.
   */
  constructor(opts = {}) {
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/+$/, '');
    this.timeout = opts.timeout ?? 15000;
    this.retries = opts.retries ?? 2;
    this._fetch = opts.fetch || globalThis.fetch;
    if (!this._fetch) throw new Error('No fetch available; pass one via { fetch }.');

    this.providers = {
      /** Search the NPPES NPI registry. postal_code is a 5-digit ZIP and matches practice locations. @param {{state?:string,city?:string,postal_code?:string,taxonomy?:string,first_name?:string,last_name?:string,organization?:string,limit?:number}} p */
      search: (p = {}) => this.get('/providers/search', p),
      /** One provider by 10-digit NPI. @param {string} npi */
      get: (npi) => this.get(`/providers/${encodeURIComponent(npi)}`),
    };
    this.clearances = {
      /** 510(k) clearances. @param {{q?:string,applicant?:string,since?:string,limit?:number}} p */
      search: (p = {}) => this.get('/clearances/search', p),
    };
    this.devices = {
      /** Device recalls. @param {{q?:string,limit?:number}} p */
      recalls: (p = {}) => this.get('/devices/recalls', p),
      /** MAUDE adverse events. @param {{q?:string,limit?:number}} p */
      events: (p = {}) => this.get('/devices/events', p),
    };
    this.labels = {
      /** Structured drug labeling. @param {{q?:string,brand?:string,generic?:string,limit?:number}} p */
      search: (p = {}) => this.get('/labels/search', p),
    };
    this.trials = {
      /** ClinicalTrials.gov studies. @param {{condition?:string,intervention?:string,location?:string,status?:string,limit?:number}} p */
      search: (p = {}) => this.get('/trials/search', p),
    };
    this.hospitals = {
      /** CMS Hospital General Information. @param {{state?:string,city?:string,name?:string,limit?:number}} p */
      search: (p = {}) => this.get('/hospitals/search', p),
    };
  }

  /** The service index: every endpoint, whether it is live, and its upstream. */
  index() { return this.get(''); }

  /** Liveness plus an upstream reachability probe. */
  health() { return this.get('/health'); }

  /**
   * Low-level request. Most callers should use the namespaced helpers.
   * @param {string} path e.g. '/trials/search'
   * @param {Record<string,any>} [params]
   */
  async get(path, params = {}) {
    const qs = Object.entries(params)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `${this.baseUrl}${path}${qs ? '?' + qs : ''}`;

    let lastErr = null;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeout);
      try {
        const r = await this._fetch(url, { headers: { Accept: 'application/json' }, signal: ctrl.signal });
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          const err = new SolvingHealthError(r.status, body, url);
          if (err.retryable && attempt < this.retries) { lastErr = err; await sleep(400 * (attempt + 1)); continue; }
          throw err;
        }
        return body;
      } catch (e) {
        if (e instanceof SolvingHealthError) throw e;
        lastErr = e;
        if (attempt < this.retries) { await sleep(400 * (attempt + 1)); continue; }
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  }
}

/** Convenience singleton for one-liners. */
export const sh = new SolvingHealth();
export default SolvingHealth;
