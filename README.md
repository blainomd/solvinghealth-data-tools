# SolvingHealth data tools

The code behind the public, read-only federal health data lookups at
[solvinghealth.com](https://solvinghealth.com): NPI records, FDA 510(k)
clearances, device recalls and adverse events, drug labels, clinical trials
and CMS hospitals. Every result carries the upstream source URL and the time
it was retrieved, so you can check any fact against the source.

No key. No account. Nothing stored. Send no patient information.

## Use it

Over MCP (HTTP, nothing to install):

```bash
claude mcp add --transport http solvinghealth https://solvinghealth.com/api/data-mcp
```

Or run the MCP server locally (Node 18+, zero dependencies):

```bash
node public/sdk/mcp-server.mjs
```

Or call the HTTP API directly:

```bash
curl "https://solvinghealth.com/api/v1/providers/search?taxonomy=Orthopaedic%20Surgery&postal_code=80303&limit=5"
```

`GET https://solvinghealth.com/api/v1` lists every endpoint, whether it is
live, and which government dataset it reads.

## What is here

| Path | What it is |
|---|---|
| `api/v1/[...path].js` | The HTTP gateway. Calls NPPES, openFDA, ClinicalTrials.gov and data.cms.gov, selects fields, and returns them with `source_url` and `retrieved_at`. |
| `api/data-mcp.js` | The same tools over MCP Streamable HTTP. Stateless. |
| `public/sdk/mcp-server.mjs` | The MCP server (stdio), eleven tools. |
| `public/sdk/solvinghealth.mjs`, `solvinghealth.py` | Small clients for JavaScript and Python. |
| `packages/suspension-kit/deadlines.mjs` | Date arithmetic for the `/suspension/deadlines` endpoint, from 42 CFR Part 405 Subpart C. |

## The tools

`find_providers`, `get_provider`, `search_clearances`, `search_device_recalls`,
`search_adverse_events`, `search_drug_labels`, `search_trials`,
`search_hospitals`, `list_endpoints`, and two that forward to ClinicalSwipe's
family caregiver navigator: `caregiver_questionnaire`, `caregiver_plan`.

## Honest limits

- This is a convenience layer. The official sources need no key either:
  [NPPES NPI Registry API](https://npiregistry.cms.hhs.gov/api-page),
  [openFDA](https://open.fda.gov/apis/),
  [ClinicalTrials.gov API](https://clinicaltrials.gov/data-api/api),
  [CMS Provider Data](https://data.cms.gov/provider-data/).
  What this adds is one call shape, the source on every result, and MCP.
- Upstream rate limits and outages pass through.
- Endpoints that cannot be served honestly answer 501 with the reason.
- Not medical, coding, billing or legal advice.

## Check it

```bash
node test/smoke.mjs
```

## License

Apache-2.0. See `LICENSE`.
