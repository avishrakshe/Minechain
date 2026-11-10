// Single Fuji API endpoint for avalanche-cli, combining two backends:
//   - our partial-sync node (P-Chain, info, health, and MineChain's own /ext/bc/<id>/rpc), which still
//     serves platform.getBalance and other methods the public API has dropped;
//   - the public Fuji API for the C-Chain and X-Chain, which a partial-sync node does not run.
// Usage: node l1/fuji-api-proxy.mjs [listenPort=9660] [nodeUrl=http://127.0.0.1:9650]
import http from "node:http";
import https from "node:https";

const PORT = Number(process.argv[2] ?? 9660);
const NODE = new URL(process.argv[3] ?? "http://127.0.0.1:9650");
const PUBLIC = new URL("https://api.avax-test.network");
const toPublic = (path) => /^\/ext\/bc\/(C|X)(\/|$)/.test(path);

http
  .createServer((req, res) => {
    const target = toPublic(req.url) ? PUBLIC : NODE;
    const client = target.protocol === "https:" ? https : http;
    const headers = { ...req.headers, host: target.host };
    const upstream = client.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", (e) => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`upstream ${target.host} error: ${e.message}`);
    });
    req.pipe(upstream);
  })
  .listen(PORT, "127.0.0.1", () => console.log(`fuji-api-proxy on :${PORT} (C/X -> ${PUBLIC.host}, rest -> ${NODE.host})`));
