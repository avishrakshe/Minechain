// Single Fuji API endpoint for avalanche-cli, combining two backends:
//   - the public Fuji API (full C/X/P chains), and
//   - our partial-sync node, which still serves methods the public API has dropped
//     (e.g. platform.getBalance) and MineChain's own /ext/bc/<id>/rpc.
// Routing: C/X-Chain -> public. P-Chain -> public, retried on our node when the public API answers
// "the method ... is not available". Everything else (info, health, MineChain RPC) -> our node.
// Usage: node l1/fuji-api-proxy.mjs [listenPort=9660] [nodeUrl=http://127.0.0.1:9650]
import http from "node:http";
import https from "node:https";

const PORT = Number(process.argv[2] ?? 9660);
const NODE = new URL(process.argv[3] ?? "http://127.0.0.1:9650");
const PUBLIC = new URL("https://api.avax-test.network");

function send(target, req, body) {
  const client = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const up = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: req.url,
        method: req.method,
        // Ask for an uncompressed response: the fallback check reads the body text.
        headers: { ...req.headers, host: target.host, "content-length": Buffer.byteLength(body), "accept-encoding": "identity" },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c)).on("end", () => resolve({ status: res.statusCode ?? 502, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    up.on("error", reject);
    up.end(body);
  });
}

http
  .createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    try {
      let out;
      if (/^\/ext\/bc\/(C|X)(\/|$)/.test(req.url)) {
        out = await send(PUBLIC, req, body);
      } else if (/^\/ext\/(bc\/)?P(\/|$)/.test(req.url)) {
        out = await send(PUBLIC, req, body);
        if (/is not available/.test(out.body.toString())) out = await send(NODE, req, body);
      } else {
        out = await send(NODE, req, body);
      }
      const { "content-length": _cl, "transfer-encoding": _te, ...headers } = out.headers;
      res.writeHead(out.status, headers);
      res.end(out.body);
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream error: ${e.message}`);
    }
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fuji-api-proxy on :${PORT} (C/X/P -> ${PUBLIC.host}, fallback + rest -> ${NODE.host})`));
