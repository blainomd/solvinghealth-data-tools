// Starts the stdio MCP server, lists its tools and makes one live read-only call. Exit 0 = both worked.
import { spawn } from 'node:child_process';
const c = spawn('node', [new URL('../public/sdk/mcp-server.mjs', import.meta.url).pathname], { stdio: ['pipe', 'pipe', 'inherit'] });
let buf = ''; const got = {};
c.stdout.on('data', (d) => { buf += d; for (const l of buf.split('\n').slice(0, -1)) { try { const m = JSON.parse(l); got[m.id] = m; } catch {} } buf = buf.slice(buf.lastIndexOf('\n') + 1); });
const send = (m) => c.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
send({ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'smoke', version: '0' } } });
send({ method: 'notifications/initialized' });
send({ id: 2, method: 'tools/list' });
send({ id: 3, method: 'tools/call', params: { name: 'list_endpoints', arguments: {} } });
const t = setTimeout(() => { console.error('FAIL timeout'); c.kill(); process.exit(1); }, 30000);
const iv = setInterval(() => {
  if (!got[2] || !got[3]) return;
  clearInterval(iv); clearTimeout(t); c.kill();
  const n = got[2].result?.tools?.length || 0, ok3 = !got[3].error && !got[3].result?.isError;
  console.log(`tools: ${n}; list_endpoints call: ${ok3 ? 'ok' : 'FAILED'}`);
  process.exit(n === 11 && ok3 ? 0 : 1);
}, 200);
