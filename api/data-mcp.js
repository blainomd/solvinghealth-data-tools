// /api/data-mcp (2026-11-18): the read-only federal data tools of /sdk/mcp-server.mjs, over MCP Streamable HTTP.
//   claude mcp add --transport http solvinghealth https://solvinghealth.com/api/data-mcp
// Stateless: no session id, no key, nothing stored. Each tool calls the public /api/v1 (and ClinicalSwipe's caregiver
// navigator for its two tools), so the limits and sources of those endpoints apply unchanged. JSON replies only, no
// stream. No CORS header: MCP clients are not browsers, and an open Origin is not needed for a read-only door.
// Loaded with import(): Vercel runs this file as CommonJS, which cannot require() an .mjs module.

const VERSIONS = ['2025-06-18', '2025-11-25', '2025-03-26', '2024-11-05'];
const MAX_BODY = 64 * 1024;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('allow', 'POST');
    res.setHeader('content-type', 'application/json');
    return res.status(405).send(JSON.stringify(rpcError(null, -32000, 'POST a JSON-RPC message. This server is stateless and opens no stream.')));
  }
  let body = req.body;
  try {
    if (typeof body === 'string') {
      if (body.length > MAX_BODY) throw new Error('too large');
      body = JSON.parse(body);
    } else if (body && JSON.stringify(body).length > MAX_BODY) throw new Error('too large');
  } catch {
    res.setHeader('content-type', 'application/json');
    return res.status(400).send(JSON.stringify(rpcError(null, -32700, 'Parse error')));
  }
  const batch = Array.isArray(body);
  const msgs = (batch ? body : [body]).slice(0, 20);
  if (!msgs.length || msgs.some((m) => !m || typeof m !== 'object' || m.jsonrpc !== '2.0')) {
    res.setHeader('content-type', 'application/json');
    return res.status(400).send(JSON.stringify(rpcError(null, -32600, 'Invalid Request')));
  }
  const { rpc } = await import('../public/sdk/mcp-server.mjs');
  const replies = (await Promise.all(msgs.map((m) => rpc(m, VERSIONS).catch((e) => rpcError(m.id, -32603, 'Internal error'))))).filter(Boolean);
  if (!replies.length) return res.status(202).end(); // notifications only
  res.setHeader('content-type', 'application/json');
  return res.status(200).send(JSON.stringify(batch ? replies : replies[0]));
}
