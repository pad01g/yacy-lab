// lab サーバー: 2 つの役割を 1 プロセスで持つ。
//   1. コーパス配信。Host ヘッダ（alpha.lab / beta.lab / gamma.lab）ごとに corpus.ts の頁を返す。
//   2. ブートストラップ。/seed/<cluster>.txt で、そのクラスタ各ノードの自己 seed を集めて返す。
//      YaCy は起動時と「接続ピア 0」の間、network.unit.bootstrap.seedlist* を読みに来る。
//      Last-Modified が無い seed list は捨てられるので必ず付ける。
//      新規ピアは全員 PeerType=virgin で、YaCy は virgin / junior の seed を受け入れない。
//      全員が同時に起動する閉じた網ではこれで誰もつながらないので、配る seed だけ senior に書き換える。
//      接続後は hello の往復で各ピアが実際の到達性から自分の種別を決め直す。
import { createServer } from "node:http";
import { gunzipSync } from "node:zlib";
import { buildCorpus, renderPage, SITES } from "./corpus.ts";

const PORT = Number(process.env.PORT ?? 80);
// 例: CLUSTERS="upstream=up-1,up-2,up-3;fork=fork-1,fork-2,fork-3"
const CLUSTERS = new Map(
  (process.env.CLUSTERS ?? "")
    .split(";")
    .filter(Boolean)
    .map((c) => {
      const [name, nodes] = c.split("=");
      return [name, nodes.split(",")] as const;
    }),
);

const pages = buildCorpus();
const bySite = new Map<string, Map<string, string>>();
for (const site of SITES) bySite.set(site, new Map());
for (const p of pages) bySite.get(p.site)!.set(p.path, renderPage(p));
for (const site of SITES) {
  const links = [...bySite.get(site)!.keys()].map((path) => `<li><a href="${path}">${path}</a></li>`).join("\n");
  bySite.get(site)!.set("/", `<!doctype html><html><head><meta charset="utf-8"><title>${site}</title></head><body><ul>\n${links}\n</ul></body></html>`);
}

// seed 文字列は "z|" + gzip + URL-safe base64（YaCy の Base64Order.enhancedCoder）。"p|" + 平文も読める
function asSenior(encoded: string): string {
  if (!encoded.startsWith("z|")) return encoded;
  const plain = gunzipSync(Buffer.from(encoded.slice(2), "base64url")).toString("utf8");
  return "p|" + plain.replace(/PeerType=virgin/, "PeerType=senior");
}

async function seedLines(nodes: string[]): Promise<string> {
  const lines = await Promise.all(
    nodes.map(async (node) => {
      try {
        const res = await fetch(`http://${node}:8090/yacy/seedlist.html?my=`, { signal: AbortSignal.timeout(3000) });
        return res.ok ? asSenior((await res.text()).trim()) : "";
      } catch {
        return "";
      }
    }),
  );
  return lines.filter(Boolean).join("\n") + "\n";
}

createServer(async (req, res) => {
  const host = (req.headers.host ?? "").split(":")[0];
  const path = (req.url ?? "/").split("?")[0];
  const send = (status: number, type: string, body: string): void => {
    res.writeHead(status, { "content-type": type, "last-modified": new Date().toUTCString() });
    res.end(req.method === "HEAD" ? undefined : body);
  };

  const seed = path.match(/^\/seed\/([\w-]+)\.txt$/);
  if (seed) {
    const nodes = CLUSTERS.get(seed[1]);
    if (!nodes) return send(404, "text/plain", "unknown cluster\n");
    return send(200, "text/plain; charset=utf-8", req.method === "HEAD" ? "" : await seedLines(nodes));
  }
  if (path === "/health") return send(200, "text/plain", "ok\n");

  const site = bySite.get(host);
  if (!site) return send(404, "text/plain", `unknown host ${host}\n`);
  if (path === "/robots.txt") return send(200, "text/plain", "User-agent: *\nAllow: /\n");
  const html = site.get(path);
  if (!html) return send(404, "text/plain", "not found\n");
  send(200, "text/html; charset=utf-8", html);
}).listen(PORT, () => console.log(`lab server on :${PORT}, ${pages.length} pages, clusters: ${[...CLUSTERS.keys()].join(", ")}`));
