// Production entry (npm start): one address per page before Astro handles the request.
// www.frankencoin.com -> frankencoin.com, and /path/ -> /path, with a permanent redirect.
// This runs in front of both prerendered files and server-rendered pages, which Astro's own middleware does not.
import http from "node:http";

process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler } = await import("./dist/server/entry.mjs");

const CANONICAL_HOST = "frankencoin.com";
const REDIRECT_HOSTS = new Set(["www.frankencoin.com"]);

const server = http.createServer((req, res) => {
  const host = (req.headers.host ?? "").toLowerCase().replace(/:\d+$/, "");
  const [path, query] = splitUrl(req.url ?? "/");
  const fromWww = REDIRECT_HOSTS.has(host);
  const slash = path.length > 1 && path.endsWith("/");
  if (fromWww || slash) {
    const target = (fromWww ? `https://${CANONICAL_HOST}` : "") + (slash ? path.replace(/\/+$/, "") || "/" : path) + query;
    // 308 keeps the method and body for anything that is not a plain page load.
    res.writeHead(req.method === "GET" || req.method === "HEAD" ? 301 : 308, { Location: target });
    res.end();
    return;
  }
  handler(req, res);
});

function splitUrl(url) {
  const i = url.indexOf("?");
  return i === -1 ? [url, ""] : [url.slice(0, i), url.slice(i)];
}

const port = Number(process.env.PORT ?? 8080);
server.listen(port, process.env.HOST ?? "0.0.0.0", () => console.log(`Server listening on port ${port}`));
