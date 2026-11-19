#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Blaine Warkentine. Licensed under the Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0
/**
 * SolvingHealth Public Data API — MCP server (stdio)
 *
 * Gives any MCP client (Claude Code, Claude Desktop, or your own agent) live
 * read access to federal health data: NPI records, 510(k) clearances, device
 * recalls and adverse events, drug labels, clinical trials, and CMS hospitals.
 *
 * Two more tools call ClinicalSwipe's family caregiver navigator directly
 * (https://clinicalswipe.com/api/caregiver): its questions, and a plan built
 * from a family's answers. The navigator keeps its own rules; these tools
 * forward the call and return what it says.
 *
 * Install — no npm install, no key. Over HTTP, nothing to download:
 *   claude mcp add --transport http solvinghealth https://solvinghealth.com/api/data-mcp
 * Or run it locally:
 *   curl -O https://solvinghealth.com/sdk/mcp-server.mjs
 *   claude mcp add solvinghealth -- node ./mcp-server.mjs
 *
 * Or add to claude_desktop_config.json:
 *   { "mcpServers": { "solvinghealth": { "command": "node", "args": ["/abs/path/mcp-server.mjs"] } } }
 *
 * Zero dependencies. Node 18+. Speaks JSON-RPC 2.0 over stdio.
 * No key, no PHI. The federal-data tools are read-only, and every result
 * carries its source URL. caregiver_plan sends a family's answers to
 * clinicalswipe.com, which does not store or log them.
 */

const BASE = process.env.SOLVINGHEALTH_BASE_URL || 'https://solvinghealth.com/api/v1';
const NAVIGATOR = process.env.CLINICALSWIPE_NAVIGATOR_URL || 'https://clinicalswipe.com/api/caregiver';
const PROTOCOL_VERSION = '2024-11-05';
const SERVER = { name: 'solvinghealth', version: '1.1.0' };

/* ---------- tools ---------- */

const S = (desc, extra = {}) => ({ type: 'string', description: desc, ...extra });
const N = (desc) => ({ type: 'integer', description: desc, minimum: 1, maximum: 50 });

const TOOLS = [
  {
    name: 'find_providers',
    description:
      'Search the CMS NPPES NPI registry for clinicians or organizations. Use for "find orthopedic surgeons in Colorado", ' +
      '"orthopaedic surgeons in ZIP 80303", verifying a practice name, or listing a taxonomy in a city. ' +
      'Returns NPI, name, credential, taxonomies with state licenses, addresses and secondary practice locations.',
    inputSchema: {
      type: 'object',
      properties: {
        state: S('Two-letter state code, e.g. CO'),
        city: S('City name'),
        postal_code: S('5-digit US ZIP code (or ZIP+4). Matches practice-location addresses, including secondary practice locations', { pattern: '^\\d{5}(-?\\d{4})?$' }),
        taxonomy: S('Specialty as NPPES words it, e.g. "Orthopaedic Surgery" (British spelling)'),
        first_name: S('Given name of an individual provider'),
        last_name: S('Family name of an individual provider'),
        organization: S('Organization name'),
        limit: N('Max results, 1-50 (default 10)'),
      },
    },
    call: (a) => req('/providers/search', a),
  },
  {
    name: 'get_provider',
    description: 'Look up one provider by 10-digit NPI. Use to verify an NPI is real, active, and matches the specialty you expect.',
    inputSchema: { type: 'object', properties: { npi: S('The 10-digit NPI') }, required: ['npi'] },
    call: (a) => req(`/providers/${encodeURIComponent(a.npi || '')}`),
  },
  {
    name: 'search_clearances',
    description:
      'Search FDA 510(k) device clearances (openFDA). Use to check whether a device type has been cleared, who cleared it, ' +
      'and when — e.g. "is there a cleared knee goniometer", "what did Stryker clear since 2024".',
    inputSchema: {
      type: 'object',
      properties: {
        q: S('Device name to match, e.g. "knee"'),
        applicant: S('Company name, e.g. "Stryker"'),
        since: S('Earliest decision date, YYYYMMDD'),
        limit: N('Max results, 1-50'),
      },
    },
    call: (a) => req('/clearances/search', a),
  },
  {
    name: 'search_device_recalls',
    description: 'Search FDA device recall records. Use for safety history on an implant or device family before citing it.',
    inputSchema: { type: 'object', properties: { q: S('Product description to match'), limit: N('Max results, 1-50') } },
    call: (a) => req('/devices/recalls', a),
  },
  {
    name: 'search_adverse_events',
    description: 'Search FDA MAUDE device adverse event reports. Use for real-world failure modes reported for a device type.',
    inputSchema: { type: 'object', properties: { q: S('Generic device name, e.g. "knee prosthesis"'), limit: N('Max results, 1-50') } },
    call: (a) => req('/devices/events', a),
  },
  {
    name: 'search_drug_labels',
    description: 'Search FDA structured drug labeling (SPL) for indications and boxed warnings. Use to check what a drug is labeled for.',
    inputSchema: {
      type: 'object',
      properties: { q: S('Brand or generic name'), brand: S('Brand name'), generic: S('Generic name'), limit: N('Max results, 1-50') },
    },
    call: (a) => req('/labels/search', a),
  },
  {
    name: 'search_trials',
    description:
      'Search ClinicalTrials.gov (API v2) for registered studies. Use for "what is recruiting for knee OA", ' +
      'evidence landscape questions, or checking whether a claimed trial exists.',
    inputSchema: {
      type: 'object',
      properties: {
        condition: S('Condition, e.g. "knee osteoarthritis"'),
        intervention: S('Intervention or drug/device name'),
        location: S('Where the study runs: a state, city or country, e.g. "Colorado"'),
        status: S('Overall status, e.g. RECRUITING, COMPLETED'),
        limit: N('Max results, 1-50'),
      },
    },
    call: (a) => req('/trials/search', a),
  },
  {
    name: 'search_hospitals',
    description: 'Search the CMS Hospital General Information file: ownership, type, emergency services, and overall star rating.',
    inputSchema: {
      type: 'object',
      properties: { state: S('Two-letter state code'), city: S('City name'), name: S('Partial facility name'), limit: N('Max results, 1-50') },
    },
    call: (a) => req('/hospitals/search', a),
  },
  {
    name: 'list_endpoints',
    description:
      'List every API endpoint, whether it is live, and which government dataset it reads. ' +
      'Call this first if unsure what data is available — it also names what is deliberately NOT implemented and why, ' +
      'and lists open endpoints that run elsewhere, such as the family caregiver navigator.',
    inputSchema: { type: 'object', properties: {} },
    call: () => req(''),
  },
  {
    name: 'caregiver_questionnaire',
    description:
      "Get the questions for ClinicalSwipe's family caregiver navigator: who is being cared for, their coverage, family doctor, " +
      'what is going on, military service, money and state. Returns each question with its answer codes, plus the full resource ' +
      'catalog, each resource with its official source URL and the date it was checked. format "fhir" returns the FHIR R4 ' +
      'Questionnaire instead. Call this before caregiver_plan so the answers use the codes it lists.',
    inputSchema: {
      type: 'object',
      properties: {
        format: S('"json" (default): plain questions and the catalog. "fhir": the FHIR R4 Questionnaire.', { enum: ['json', 'fhir'] }),
      },
    },
    call: (a) => (a.format === 'fhir' ? caregiverCall('GET', '/questionnaire', undefined, true) : caregiverCall('GET', '/questionnaire?format=json')),
  },
  {
    name: 'caregiver_plan',
    description:
      "Build a family caregiver's plan with ClinicalSwipe's navigator: public programs first, then what to ask the family doctor, " +
      'then neighbor help, then what is not open yet, labeled as such. Every step names its source page and the date it was checked. ' +
      'A step that needs a clinician says who, what and why, and signs: true marks only the steps a program requires a clinician ' +
      'to sign or certify. General information from official program pages, not medical, legal or financial advice; each program ' +
      'decides its own eligibility. The answers go to clinicalswipe.com, which does not store or log them. Send no names or identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        answers: {
          type: 'object',
          description:
            "Plain answers keyed by the questionnaire's question ids, using the codes caregiver_questionnaire lists, " +
            'e.g. {"coverage":"medicare","doctor":"yes","state":"CO","situation":["memory"]}',
        },
        questionnaire_response: { type: 'object', description: 'A FHIR R4 QuestionnaireResponse to the navigator questionnaire, instead of answers.' },
        format: S('"json" (default) or "fhir" for a FHIR R4 CarePlan. A QuestionnaireResponse always gets a CarePlan.', { enum: ['json', 'fhir'] }),
      },
    },
    call: (a) => {
      let body = a.questionnaire_response ?? a.answers;
      if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = null; }
      }
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { error: 'invalid_input', detail: 'Pass answers or questionnaire_response. Call caregiver_questionnaire for the questions and their codes.' };
      }
      const fhir = a.format === 'fhir';
      return caregiverCall('POST', fhir ? '/plan?format=fhir' : '/plan', body, fhir);
    },
  },
];

/* ---------- HTTP ---------- */

function req(path, params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  return fetchJSON(`${BASE}${path}${qs ? '?' + qs : ''}`, { headers: { Accept: 'application/json' } });
}

// The navigator runs at ClinicalSwipe, which keeps its one rules source.
// Nothing passes through solvinghealth.com on the way.
function caregiverCall(method, path, body, fhir = false) {
  const headers = { Accept: fhir ? 'application/fhir+json' : 'application/json' };
  const init = { method, headers };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return fetchJSON(`${NAVIGATOR}${path}`, init);
}

async function fetchJSON(url, init) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await r.json().catch(() => null);
    if (!r.ok) {
      // Undefined fields drop out of the JSON, so each upstream keeps only what it sent.
      // The navigator's `details` names each answer it could not use and the codes it allows.
      return {
        error: body?.error || `http_${r.status}`,
        detail: body?.detail || body?.message || body?.issue?.[0]?.diagnostics || `Request failed with ${r.status}`,
        details: body?.details,
        official_source: body?.official_source,
        questionnaire: body?.questionnaire,
        request_url: url,
      };
    }
    return body;
  } catch (e) {
    return { error: 'request_failed', detail: e.name === 'AbortError' ? 'timed out after 20s' : String(e.message || e), request_url: url };
  } finally {
    clearTimeout(t);
  }
}

/* ---------- JSON-RPC (shared by stdio and solvinghealth.com/api/data-mcp) ---------- */

// The same tools also answer over HTTP at https://solvinghealth.com/api/data-mcp (stateless, no key), which imports
// rpc() from this file. Run directly, this file speaks stdio exactly as before.
const ok = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// One JSON-RPC message in, one reply out (null for a notification, which expects none).
// `versions`: protocol versions the transport accepts; the client's is echoed when listed, else the first one.
export async function rpc(msg, versions = [PROTOCOL_VERSION]) {
  const { id, method, params } = msg || {};
  // Notifications carry no id and expect no reply.
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return ok(id, {
        protocolVersion: versions.includes(asked) ? asked : versions[0],
        capabilities: { tools: {} },
        serverInfo: SERVER,
        instructions:
          'Read-only access to federal health data (NPPES, openFDA, ClinicalTrials.gov, CMS). ' +
          'Every result includes source_url and retrieved_at — cite those, not this server. ' +
          "caregiver_questionnaire and caregiver_plan call ClinicalSwipe's family caregiver navigator: general information from " +
          'official program pages, not medical, legal or financial advice; each program decides its own eligibility; answers are not stored. ' +
          'No key. Send no PHI and no names.',
      });
    }

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });

    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${params?.name}`);
      const data = await tool.call(params.arguments || {});
      const isErr = !!data?.error;
      return ok(id, {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        isError: isErr,
      });
    }

    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

/* ---------- stdio (only when this file is run, not when it is imported) ---------- */

const RUN = typeof process !== 'undefined' && process.argv[1] &&
  decodeURIComponent(new URL(import.meta.url).pathname).endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());

if (RUN) {
  let buf = '';
  let inFlight = 0;
  let stdinClosed = false;
  const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');

  // Exit only once every in-flight request has answered — otherwise piping a
  // batch of requests drops the replies still awaiting an upstream fetch.
  const maybeExit = () => { if (stdinClosed && inFlight === 0) process.exit(0); };

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      inFlight++;
      rpc(msg)
        .then((reply) => { if (reply) send(reply); })
        .catch((e) => {
          if (msg && msg.id != null) send(fail(msg.id, -32603, String(e.message || e)));
        })
        .finally(() => {
          inFlight--;
          maybeExit();
        });
    }
  });
  process.stdin.on('end', () => {
    stdinClosed = true;
    maybeExit();
  });
}
