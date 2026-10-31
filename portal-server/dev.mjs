// Local test server: runs the portal Worker code in Node with in-memory storage.
//   node portal-server/dev.mjs   ->  http://localhost:8787   (lab key: dev-lab-key)
import http from 'node:http';
import { makeEnv, worker } from './fake-do.mjs';
const port = Number(process.env.PORT || 8787);
const env = makeEnv({ ALLOWED_ORIGIN: process.env.ALLOWED_ORIGIN || 'http://localhost:8765', LAB_API_KEY: 'dev-lab-key' });
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await worker.fetch(new Request('http://localhost:' + port + req.url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env);
  const h = {}; r.headers.forEach((v, k) => { h[k] = v; });
  res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer()));
}).listen(port, () => console.log('portal dev server on http://localhost:' + port));
