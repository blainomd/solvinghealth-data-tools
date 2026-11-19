/**
 * SolvingHealth Public Data API — v1
 *
 * A read-only gateway over federal health datasets that actually answer.
 * Every response carries its upstream source URL and a retrieval timestamp,
 * so a caller can re-derive any fact without trusting us.
 *
 * Base URL: https://solvinghealth.com/api/v1
 * No key required. No PHI. No writes.
 *
 * Endpoints that cannot be served honestly return 501 with the reason —
 * we do not synthesize data we cannot fetch.
 */

const VERSION = '1.0.0';
const UA = 'SolvingHealth-API/1.0 (+https://solvinghealth.com/developers)';
const TIMEOUT_MS = 12000;

const DISCLAIMER =
  'Public federal data, passed through unmodified except for field selection. ' +
  'Not medical, coding, billing or legal advice. Verify against the source_url before relying on it.';

/* ---------- helpers ---------- */

async function upstream(url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs || TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* non-JSON upstream */ }
    return { ok: r.ok, status: r.status, body, raw: text };
  } catch (e) {
    return { ok: false, status: 504, body: null, error: e.name === 'AbortError' ? 'upstream timeout' : String(e.message || e) };
  } finally {
    clearTimeout(t);
  }
}

function envelope(source, source_url, results, extra) {
  return Object.assign({
    ok: true,
    api_version: VERSION,
    source,
    source_url,
    retrieved_at: new Date().toISOString(),
    count: Array.isArray(results) ? results.length : (results ? 1 : 0),
    results,
    disclaimer: DISCLAIMER,
  }, extra || {});
}

function fail(res, status, error, detail) {
  return res.status(status).json({ ok: false, api_version: VERSION, error, detail: detail || undefined });
}

const clampLimit = (v, def, max) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), max || 50) : (def || 10);
};

const q = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

// openFDA's AND/OR/TO operators must reach it as spaces. Written as '+AND+' they get
// percent-encoded to '%2BAND%2B' by the query builder and every multi-term search 404s.
const fdaEscape = (s) => String(s).replace(/["\\]/g, ' ').trim();

const mapProvider = (x) => ({
  npi: x.number,
  type: x.enumeration_type === 'NPI-1' ? 'individual' : 'organization',
  name: x.basic?.organization_name || [x.basic?.first_name, x.basic?.last_name].filter(Boolean).join(' '),
  credential: x.basic?.credential || null,
  status: x.basic?.status === 'A' ? 'active' : (x.basic?.status || null),
  enumeration_date: x.basic?.enumeration_date || null,
  primary_taxonomy: (x.taxonomies || []).find((t) => t.primary)?.desc || null,
  taxonomies: (x.taxonomies || []).map((t) => ({ code: t.code, desc: t.desc, state: t.state, license: t.license, primary: !!t.primary })),
  addresses: (x.addresses || []).map((a) => ({
    purpose: (a.address_purpose || '').toLowerCase(),
    line1: a.address_1, line2: a.address_2 || null, city: a.city, state: a.state,
    postal_code: a.postal_code, phone: a.telephone_number || null,
  })),
  // NPPES keeps secondary practice locations apart from `addresses`. A postal_code search
  // can match on one of these, so return them or the match looks like a wrong answer.
  practice_locations: (x.practiceLocations || []).map((a) => ({
    line1: a.address_1, line2: a.address_2 || null, city: a.city, state: a.state,
    postal_code: a.postal_code, phone: a.telephone_number || null,
  })),
});

/* ---------- endpoint catalogue (also the service index) ---------- */

const CATALOGUE = [
  { path: '/health', desc: 'Liveness plus an upstream reachability probe.', params: [], live: true },
  { path: '/providers/search', desc: 'Find providers in the NPPES NPI registry.', params: ['state', 'city', 'postal_code', 'taxonomy', 'first_name', 'last_name', 'organization', 'limit'], live: true, upstream: 'NPPES NPI Registry (CMS)', note: 'state on its own is rejected upstream as too broad — pair it with taxonomy, city, postal_code or a name. postal_code is a 5-digit ZIP (or ZIP+4; `zip` is accepted as an alias) and matches practice-location addresses, including secondary practice locations. taxonomy matches any taxonomy on the record, not only the primary one.', example: '/api/v1/providers/search?taxonomy=Orthopaedic%20Surgery&postal_code=80303&limit=3' },
  { path: '/providers/{npi}', desc: 'One provider by 10-digit NPI.', params: [], live: true, upstream: 'NPPES NPI Registry (CMS)' },
  { path: '/clearances/search', desc: '510(k) device clearances.', params: ['q', 'applicant', 'since', 'limit'], live: true, upstream: 'openFDA device/510k' },
  { path: '/devices/recalls', desc: 'Device recall records.', params: ['q', 'limit'], live: true, upstream: 'openFDA device/recall' },
  { path: '/devices/events', desc: 'Adverse event reports (MAUDE).', params: ['q', 'limit'], live: true, upstream: 'openFDA device/event' },
  { path: '/labels/search', desc: 'Structured drug labeling (SPL).', params: ['q', 'brand', 'generic', 'limit'], live: true, upstream: 'openFDA drug/label' },
  { path: '/trials/search', desc: 'Registered clinical studies.', params: ['condition', 'intervention', 'location', 'status', 'limit'], live: true, upstream: 'ClinicalTrials.gov API v2' },
  { path: '/hospitals/search', desc: 'Hospital General Information.', params: ['state', 'city', 'name', 'limit'], live: true, upstream: 'CMS Provider Data Catalog' },
  {
    path: '/suspension/deadlines',
    desc: '15-day Medicare payment suspension rebuttal and CMS determination deadlines from a notice date, with verbatim 42 CFR 405.370-405.375 rules.',
    params: ['notice', 'rebuttal_received'],
    live: true,
    upstream: 'eCFR — 42 CFR Part 405 Subpart C (pure calculation)',
  },
  {
    path: '/exclusions/search',
    desc: 'OIG LEIE exclusion screening.',
    params: [],
    live: false,
    reason:
      'The OIG LEIE publishes a bulk CSV, not a queryable API, and that download is not reachable from this runtime. ' +
      'Rather than serve a stale or synthesized copy, this endpoint returns 501. ' +
      'Screen against the official source at https://exclusions.oig.hhs.gov/.',
  },
];

/* ---------- endpoint implementations ---------- */

async function providersSearch(p) {
  // postal_code (alias: zip) is a US ZIP: five digits, or ZIP+4 with or without the hyphen.
  // NPPES treats a 5-digit value as a prefix of the 9-digit codes it stores. It answers a
  // malformed one (three digits, letters) with zero results and no error, which reads as
  // "nobody practises there". Reject it here so a typo is not mistaken for an empty ZIP.
  let postal;
  const rawPostal = p.postal_code ?? p.zip;
  if (rawPostal !== undefined && rawPostal !== '') {
    postal = String(rawPostal).replace(/[\s-]/g, '');
    if (!/^(\d{5}|\d{9})$/.test(postal)) {
      return {
        error: 'invalid_query',
        detail: 'postal_code is a 5-digit US ZIP code, or ZIP+4. Example: /api/v1/providers/search?taxonomy=Orthopaedic%20Surgery&postal_code=80303',
      };
    }
  }
  const url =
    'https://npiregistry.cms.hhs.gov/api/?' +
    q({
      version: '2.1',
      state: p.state,
      city: p.city,
      postal_code: postal,
      // With a ZIP, match where the provider practises, not where their mail goes.
      address_purpose: postal ? 'LOCATION' : undefined,
      taxonomy_description: p.taxonomy,
      first_name: p.first_name,
      last_name: p.last_name,
      organization_name: p.organization,
      limit: clampLimit(p.limit, 10, 50),
    });
  const r = await upstream(url);
  if (!r.ok || !r.body) return { error: 'upstream_unavailable', detail: r.error || `NPPES returned ${r.status}`, url };
  if (r.body.Errors) {
    const raw = r.body.Errors.map((e) => e.description).join('; ');
    // NPPES rejects `state` on its own as too broad. That is the most natural first
    // request anyone makes, so say what to add instead of passing the bare message through.
    if (/requires additional search criteria/i.test(raw)) {
      return {
        error: 'invalid_query',
        detail:
          'NPPES will not search a whole state on its own. Add one more field: taxonomy, city, ' +
          'postal_code, last_name, first_name or organization. Example: ' +
          '/api/v1/providers/search?state=CO&taxonomy=Orthopaedic%20Surgery. ' +
          '(taxonomy, city, postal_code, last_name and first_name each also work with no state at all.)',
        upstream_message: raw,
        url,
      };
    }
    return { error: 'invalid_query', detail: raw, url };
  }
  return { results: (r.body.results || []).map(mapProvider), url, source: 'NPPES NPI Registry (CMS)' };
}

// The NPI check digit (Luhn over the NPI with the 80840 prefix, as CMS specifies). A mistyped NPI is
// refused here without a call to NPPES; a pass means well formed, not assigned (NPPES answers that).
function npiCheckDigitOk(npi) {
  const d = npi.split('').map(Number);
  let sum = 24; // the prefix 80840 contributes 24 under the Luhn doubling
  for (let i = 8; i >= 0; i--) {
    let x = d[i];
    if ((8 - i) % 2 === 0) { x *= 2; if (x > 9) x -= 9; }
    sum += x;
  }
  return (10 - (sum % 10)) % 10 === d[9];
}

async function providerByNpi(npi) {
  if (!/^\d{10}$/.test(npi)) return { error: 'invalid_npi', detail: 'An NPI is exactly 10 digits.' };
  if (!npiCheckDigitOk(npi)) return { error: 'invalid_npi', detail: 'This NPI fails its check digit, so no clinician can hold it. Check it for a typo.' };
  const url = `https://npiregistry.cms.hhs.gov/api/?${q({ version: '2.1', number: npi })}`;
  const r = await upstream(url);
  if (!r.ok || !r.body) return { error: 'upstream_unavailable', detail: r.error || `NPPES returned ${r.status}`, url };
  if (!r.body.results || r.body.results.length === 0)
    return { error: 'not_found', detail: `No NPPES record for NPI ${npi}.`, url };
  return { results: [mapProvider(r.body.results[0])], url, source: 'NPPES NPI Registry (CMS)' };
}

async function openfda(endpointPath, search, limit, mapper, sourceName, sort) {
  const url = `https://api.fda.gov/${endpointPath}?${q({ search: search || undefined, sort: sort || undefined, limit: clampLimit(limit, 10, 50) })}`;
  const r = await upstream(url);
  if (r.status === 404) return { results: [], url, source: sourceName, total: 0 };
  if (!r.ok || !r.body) return { error: 'upstream_unavailable', detail: r.error || `openFDA returned ${r.status}`, url };
  return { results: (r.body.results || []).map(mapper), url, source: sourceName, total: r.body.meta?.results?.total ?? null };
}

async function trialsSearch(p) {
  const url =
    'https://clinicaltrials.gov/api/v2/studies?' +
    q({
      'query.cond': p.condition,
      'query.intr': p.intervention,
      'query.locn': p.location,
      'filter.overallStatus': p.status ? String(p.status).toUpperCase() : undefined,
      pageSize: clampLimit(p.limit, 10, 50),
      countTotal: 'true',
    });
  const r = await upstream(url);
  if (!r.ok || !r.body) return { error: 'upstream_unavailable', detail: r.error || `ClinicalTrials.gov returned ${r.status}`, url };
  const results = (r.body.studies || []).map((s) => {
    const id = s.protocolSection?.identificationModule || {};
    const st = s.protocolSection?.statusModule || {};
    const d = s.protocolSection?.designModule || {};
    return {
      nct_id: id.nctId,
      title: id.briefTitle,
      status: st.overallStatus,
      start_date: st.startDateStruct?.date || null,
      completion_date: st.completionDateStruct?.date || null,
      phases: d.phases || [],
      enrollment: d.enrollmentInfo?.count ?? null,
      conditions: s.protocolSection?.conditionsModule?.conditions || [],
      sponsor: s.protocolSection?.sponsorCollaboratorsModule?.leadSponsor?.name || null,
      url: id.nctId ? `https://clinicaltrials.gov/study/${id.nctId}` : null,
    };
  });
  return { results, url, source: 'ClinicalTrials.gov API v2', total: r.body.totalCount ?? null };
}

// CMS's datastore query API can take 50+ seconds on a query it has not cached
// (measured 2026-10-20: any uncached filter, even no filter, ~50 s; the same
// dataset's CSV download answers in under a second). So the datastore gets a
// short budget, and when it misses we read the same CMS file from its published
// CSV distribution and filter it here. Both are CMS's own data, fetched live;
// source_url always names the one that answered.
const HGI_DATASET = 'xubh-q36u';
const HGI_DATASTORE_MS = 6000;
const HGI_CSV_TTL_MS = 6 * 60 * 60 * 1000;
let hgiCsv = null; // { url, rows, at } kept for the life of a warm instance

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function hgiCsvRows() {
  if (hgiCsv && Date.now() - hgiCsv.at < HGI_CSV_TTL_MS) return hgiCsv;
  const meta = await upstream(`https://data.cms.gov/provider-data/api/1/metastore/schemas/dataset/items/${HGI_DATASET}`, 8000);
  const dist = meta.ok && meta.body && Array.isArray(meta.body.distribution)
    ? meta.body.distribution.find((d) => d && /^https:\/\/data\.cms\.gov\//.test(d.downloadURL || '') && /csv/i.test(d.mediaType || d.downloadURL))
    : null;
  if (!dist) return { error: meta.error || `CMS metastore returned ${meta.status}` };
  const r = await upstream(dist.downloadURL, 10000);
  if (!r.ok || !r.raw) return { error: r.error || `CMS CSV returned ${r.status}` };
  const table = parseCsv(r.raw);
  const head = table.shift() || [];
  const col = (name) => head.indexOf(name);
  const ix = {
    facility_id: col('Facility ID'), facility_name: col('Facility Name'), address: col('Address'),
    citytown: col('City/Town'), state: col('State'), zip_code: col('ZIP Code'), countyparish: col('County/Parish'),
    telephone_number: col('Telephone Number'), hospital_type: col('Hospital Type'),
    hospital_ownership: col('Hospital Ownership'), emergency_services: col('Emergency Services'),
    hospital_overall_rating: col('Hospital overall rating'),
  };
  if (ix.facility_id < 0 || ix.facility_name < 0 || ix.citytown < 0 || ix.state < 0) {
    return { error: 'CMS CSV columns changed' };
  }
  const rows = table.map((t) => {
    const o = {};
    for (const [k, i] of Object.entries(ix)) o[k] = i >= 0 ? (t[i] || '') : '';
    return o;
  });
  hgiCsv = { url: dist.downloadURL, rows, at: Date.now() };
  return hgiCsv;
}

const hgiShape = (h) => ({
  ccn: h.facility_id,
  name: h.facility_name,
  address: h.address,
  city: h.citytown,
  state: h.state,
  zip: h.zip_code,
  county: h.countyparish,
  phone: h.telephone_number || null,
  type: h.hospital_type || null,
  ownership: h.hospital_ownership || null,
  emergency_services: h.emergency_services || null,
  overall_rating: h.hospital_overall_rating || null,
});

async function hospitalsSearch(p) {
  const conds = [];
  const add = (prop, value, operator) => {
    const i = conds.length;
    conds.push(
      `conditions[${i}][property]=${encodeURIComponent(prop)}` +
      `&conditions[${i}][value]=${encodeURIComponent(value)}` +
      `&conditions[${i}][operator]=${encodeURIComponent(operator || '=')}`
    );
  };
  const state = p.state ? String(p.state).toUpperCase() : '';
  const city = p.city ? String(p.city).toUpperCase() : '';
  const name = p.name ? String(p.name).toUpperCase() : '';
  const limit = clampLimit(p.limit, 10, 50);
  if (state) add('state', state);
  if (city) add('citytown', city);
  if (name) add('facility_name', `%${name}%`, 'LIKE');
  const url =
    `https://data.cms.gov/provider-data/api/1/datastore/query/${HGI_DATASET}/0?limit=${limit}` +
    (conds.length ? '&' + conds.join('&') : '');
  const source = 'CMS Provider Data Catalog — Hospital General Information';
  const r = await upstream(url, HGI_DATASTORE_MS);
  if (r.ok && r.body) return { results: (r.body.results || []).map(hgiShape), url, source };

  // Datastore slow or down: same dataset, read from CMS's CSV distribution.
  const csv = await hgiCsvRows();
  if (csv.error) {
    return { error: 'upstream_unavailable', detail: `${r.error || `CMS returned ${r.status}`}; CSV fallback: ${csv.error}`, url };
  }
  const results = csv.rows
    .filter((h) => (!state || h.state.toUpperCase() === state) &&
      (!city || h.citytown.toUpperCase() === city) &&
      (!name || h.facility_name.toUpperCase().includes(name)))
    .slice(0, limit)
    .map(hgiShape);
  return {
    results, url: csv.url, source: source + ' (CSV distribution)',
    extra: { upstream_note: `The CMS datastore query did not answer within ${HGI_DATASTORE_MS / 1000} s (${r.error || `status ${r.status}`}), so these rows were filtered from CMS's published CSV of the same dataset, fetched live from source_url.` },
  };
}

/* ---------- router ---------- */

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return fail(res, 405, 'method_not_allowed', 'This API is read-only. Use GET.');

  // Resolve the sub-path independently of how the platform populates it:
  // an explicit ?p= from the rewrite, the catch-all param, or the raw URL.
  let parts = [];
  const qp = req.query || {};
  if (qp.p !== undefined && qp.p !== null) {
    parts = String(qp.p).split('/').filter(Boolean);
  } else if (qp.path !== undefined && qp.path !== null) {
    parts = [].concat(qp.path).flatMap((x) => String(x).split('/')).filter(Boolean);
  }
  if (parts.length === 0 && req.url) {
    const raw = String(req.url).split('?')[0];
    const m = raw.match(/\/api\/v1\/?(.*)$/);
    if (m && m[1] && !m[1].startsWith('[')) parts = m[1].split('/').filter(Boolean);
  }
  const route = '/' + parts.join('/');
  const p = qp;

  try {
    if (parts.length === 0) {
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.status(200).json({
        ok: true,
        api_version: VERSION,
        name: 'SolvingHealth Public Data API',
        base_url: 'https://solvinghealth.com/api/v1',
        auth: 'none — read-only public federal data',
        no_phi: true,
        // Say the differentiator where the decision is made. Every response
        // carries source, source_url and retrieved_at — and source_url is the
        // EXACT upstream query, so a skeptic can re-run it and get the same
        // rows. That is the difference between this and an assistant that
        // answers from the same federal data without saying where or when it
        // looked; as of 2026-09-02 OpenAI ships a Healthcare Public Data
        // plugin over an overlapping set (PubMed, DailyMed, CMS Coverage).
        // The property was true in the payload and invisible in the document
        // an agent reads to decide whether to use this at all.
        provenance: {
          every_response: ['source', 'source_url', 'retrieved_at'],
          source_url: 'the exact upstream query used, re-runnable by hand — not a citation we composed',
          retrieved_at: 'ISO-8601 UTC timestamp of the upstream fetch; responses are not cached silently',
          why: 'an attested record needs a claim you can re-derive, not an answer you have to trust',
        },
        sdk: {
          javascript: 'https://solvinghealth.com/sdk/solvinghealth.mjs',
          python: 'https://solvinghealth.com/sdk/solvinghealth.py',
          mcp_server: 'https://solvinghealth.com/sdk/mcp-server.mjs',
          openapi: 'https://solvinghealth.com/.well-known/openapi.yaml',
        },
        endpoints: CATALOGUE,
        // Open endpoints that run elsewhere in the estate. Listed so an agent that
        // starts at this index finds them; linked, never proxied, so each keeps its
        // one rules source where it runs.
        open_endpoints_elsewhere: [
          {
            name: 'Family caregiver navigator',
            served_by: 'https://clinicalswipe.com',
            what:
              'A plan for a family caregiver from a few answers: public programs first, then what to ask the family doctor, ' +
              'then neighbor help. Every step names its source page and the date it was checked; signs: true marks only ' +
              'the steps a program requires a clinician to sign.',
            endpoints: [
              { method: 'GET', url: 'https://clinicalswipe.com/api/caregiver/questionnaire', returns: 'FHIR R4 Questionnaire; ?format=json returns plain questions plus the resource catalog with sources' },
              { method: 'POST', url: 'https://clinicalswipe.com/api/caregiver/plan', returns: 'plan JSON; a FHIR R4 CarePlan for a QuestionnaireResponse, with ?format=fhir, or with Accept: application/fhir+json' },
            ],
            auth: 'none',
            stores_answers: false,
            scope: 'General information from official program pages. Not medical, legal or financial advice; each program decides its own eligibility.',
            docs: 'https://clinicalswipe.com/llms.txt',
          },
        ],
        disclaimer: DISCLAIMER,
      });
    }

    if (route === '/health') {
      const probe = await upstream('https://api.fda.gov/device/510k.json?limit=1');
      return res.status(200).json({
        ok: true, api_version: VERSION, status: 'ok',
        upstream_probe: { source: 'openFDA', reachable: probe.ok, status: probe.status },
        checked_at: new Date().toISOString(),
      });
    }

    let out = null;

    if (route === '/providers/search') out = await providersSearch(p);
    else if (parts[0] === 'providers' && parts.length === 2) out = await providerByNpi(parts[1]);
    else if (route === '/clearances/search') {
      const terms = [];
      if (p.q) terms.push(`device_name:"${fdaEscape(p.q)}"`);
      if (p.applicant) terms.push(`applicant:"${fdaEscape(p.applicant)}"`);
      if (p.since) terms.push(`decision_date:[${fdaEscape(p.since)} TO 2100-01-01]`);
      out = await openfda('device/510k.json', terms.join(' AND '), p.limit, (x) => ({
        k_number: x.k_number, device_name: x.device_name, applicant: x.applicant,
        decision_date: x.decision_date, decision: x.decision_description || x.decision_code,
        product_code: x.product_code, advisory_committee: x.advisory_committee_description,
        clearance_type: x.clearance_type, state: x.state, country: x.country_code,
        url: x.k_number ? `https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/pmn.cfm?ID=${x.k_number}` : null,
      }), 'openFDA — device/510k', 'decision_date:desc'); // newest decisions first
    }
    else if (route === '/devices/recalls') {
      out = await openfda('device/recall.json', p.q ? `product_description:"${fdaEscape(p.q)}"` : '', p.limit, (x) => ({
        recall_number: x.res_event_number || x.product_res_number || null,
        product: x.product_description, reason: x.reason_for_recall,
        device_class: x.openfda?.device_class || null, firm: x.recalling_firm,
        status: x.status || null, initiated: x.event_date_initiated || null,
      }), 'openFDA — device/recall');
    }
    else if (route === '/devices/events') {
      out = await openfda('device/event.json', p.q ? `device.generic_name:"${fdaEscape(p.q)}"` : '', p.limit, (x) => ({
        report_number: x.report_number, event_type: x.event_type,
        date_received: x.date_received || null,
        device: (x.device || []).map((d) => ({ brand: d.brand_name, generic: d.generic_name, manufacturer: d.manufacturer_d_name })),
        product_problems: x.product_problems || [],
      }), 'openFDA — device/event (MAUDE)');
    }
    else if (route === '/labels/search') {
      const terms = [];
      if (p.brand) terms.push(`openfda.brand_name:"${fdaEscape(p.brand)}"`);
      if (p.generic) terms.push(`openfda.generic_name:"${fdaEscape(p.generic)}"`);
      if (p.q && terms.length === 0) terms.push(`openfda.brand_name:"${fdaEscape(p.q)}" OR openfda.generic_name:"${fdaEscape(p.q)}"`);
      out = await openfda('drug/label.json', terms.join(' AND '), p.limit, (x) => ({
        set_id: x.set_id,
        brand_names: x.openfda?.brand_name || [],
        generic_names: x.openfda?.generic_name || [],
        manufacturer: x.openfda?.manufacturer_name || [],
        route: x.openfda?.route || [],
        effective_time: x.effective_time || null,
        indications: ((x.indications_and_usage || [])[0] || '').slice(0, 1200) || null,
        warnings: ((x.boxed_warning || x.warnings || [])[0] || '').slice(0, 1200) || null,
      }), 'openFDA — drug/label');
    }
    else if (route === '/trials/search') out = await trialsSearch(p);
    else if (route === '/hospitals/search') out = await hospitalsSearch(p);
    else if (route === '/suspension/deadlines') {
      // Loaded lazily: the function is bundled as CommonJS, and a top-level import of this ES module took down every /api/v1 route.
      const { computeSuspensionDeadlines, ECFR_SUBPART_C_URL } = await import('../../packages/suspension-kit/deadlines.mjs');
      const calc = computeSuspensionDeadlines({
        notice: p.notice,
        rebuttal_received: p.rebuttal_received,
        overpayment_identified: p.overpayment_identified,
        investigation_concluded: p.investigation_concluded,
      });
      if (!calc.ok) {
        out = { error: calc.error, detail: calc.detail, url: ECFR_SUBPART_C_URL };
      } else {
        out = {
          results: [calc],
          url: ECFR_SUBPART_C_URL,
          source: 'eCFR — 42 CFR Part 405 Subpart C (§§ 405.370–405.375) & 42 CFR 401.305',
        };
      }
    }
    else if (route === '/exclusions/search') {
      const e = CATALOGUE.find((c) => c.path === '/exclusions/search');
      return res.status(501).json({
        ok: false, api_version: VERSION, error: 'not_implemented', detail: e.reason,
        official_source: 'https://exclusions.oig.hhs.gov/',
      });
    }
    else {
      return res.status(404).json({
        ok: false, api_version: VERSION, error: 'unknown_endpoint',
        detail: `No endpoint at ${route}.`,
        endpoints: CATALOGUE.map((c) => c.path),
      });
    }

    if (out.error) {
      const code = out.error === 'not_found' ? 404 : (out.error.indexOf('invalid') === 0 ? 400 : 502);
      return res.status(code).json({ ok: false, api_version: VERSION, error: out.error, detail: out.detail, upstream_message: out.upstream_message, source_url: out.url });
    }

    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=900, stale-while-revalidate=3600');
    return res.status(200).json(envelope(out.source, out.url, out.results, Object.assign({}, out.total != null ? { upstream_total: out.total } : null, out.extra || null)));
  } catch (e) {
    return fail(res, 500, 'internal_error', String(e && e.message ? e.message : e));
  }
}
