// デモ用のフロントエンド（compose.demo.yaml）。http://localhost:8800 で開く。
//   起動すると裏で網を組む: フォーク側は信頼と NAT 越えの試験と同じ構成（trustlib.ts）、upstream 側は 3 ノード。
//   どちらにも同じサイトを crawl させ、同じクエリを両方の網に global で投げて並べて見せる。
import { existsSync, readFileSync } from "node:fs";
import { createServer, request, type IncomingMessage, type ServerResponse } from "node:http";
import { judgements, TRUST_QUERIES, TOPICS } from "./corpus.ts";
import { ALL as FORK_NODES, CRAWL as FORK_CRAWL, crawlSite, LAB, log, putFile, setupTrustNetwork, sleep, until } from "./trustlib.ts";
import { held, initTrust, publishList, setDelegation, setMode, trustReady, view } from "./demotrust.ts";
import { base, fetchAdmin, mySeed, peers, search, setConfig, status, type Hit } from "./yacy.ts";

const PORT = Number(process.env.PORT ?? 8800);
const UP_NODES = ["up-1", "up-2", "up-3"];
// upstream 側: 同じサイトを持たせる。up-2 は広告頁、up-3 はスパム頁も持つ（本家には信頼の仕組みが無いので、網の誰かが持てば出る）
const UP_CRAWL: Record<string, string[]> = { "up-1": ["alpha.lab"], "up-2": ["beta.lab", "ads.lab"], "up-3": ["gamma.lab", "spam.lab"] };
const ROLES: Record<string, string> = {
  "fork-1": "信頼集合（alpha.lab）",
  "fork-2": "信頼集合（beta.lab）",
  "fork-3": "信頼集合（gamma.lab）",
  "ads-1": "信頼集合・ads タグ（ads.lab）",
  "evil-1": "署名あり・信頼集合外（spam.lab と偽の文書）",
  "nat-1": "NAT の内側・リレー経由（delta.lab）",
  "up-1": "upstream（alpha.lab）",
  "up-2": "upstream（beta.lab, ads.lab）",
  "up-3": "upstream（gamma.lab, spam.lab）",
};
// ホストから開ける管理画面（compose.demo.admin.yaml を重ねたときだけ公開される）
const UI_PORTS: Record<string, number> = { "fork-1": 8811, "fork-2": 8812, "fork-3": 8813, "ads-1": 8814, "evil-1": 8815, "up-1": 8821, "up-2": 8822, "up-3": 8823 };
const ADMIN_PORTS = process.env.DEMO_ADMIN_PORTS === "1";
/** the names under which the browser reaches this page; other Host headers are DNS rebinding */
// DEMO_PUBLIC_PORT: the port the browser sees when compose maps another one; DEMO_HOSTS: more names (comma separated),
// for a demo behind a reverse proxy
const PUBLIC_PORT = Number(process.env.DEMO_PUBLIC_PORT) || PORT;
const HOSTS = new Set([
  ...[PORT, PUBLIC_PORT].flatMap((p) => [`localhost:${p}`, `127.0.0.1:${p}`, `[::1]:${p}`]),
  `demo:${PORT}` /* the compose service name, for tests inside the Docker network */,
  ...(process.env.DEMO_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean),
]);

// ---- 状態
type NodeState = { name: string; side: "fork" | "upstream"; role: string; up: boolean; docs: number; seniors: number; reach: string; type: string; ui: string | null; trust: string };
const state = {
  phase: "starting" as "starting" | "ready" | "degraded" | "error",
  message: "ノードの起動を待っています",
  fork: "待機中",
  upstream: "待機中",
  log: [] as string[],
  nodes: new Map<string, NodeState>(),
};
const note = (msg: string): void => {
  log(msg);
  state.log.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
  if (state.log.length > 40) state.log.shift();
};

// ---- 網を組む
async function setupUpstream(): Promise<void> {
  for (const n of UP_NODES) await until(`${n} up`, 300_000, async () => ((await status(n)) ? true : undefined));
  await until("upstream peers connected", 600_000, async () => {
    const counts = await Promise.all(UP_NODES.map(async (n) => (await peers(n)).filter((p) => p.type === "senior" || p.type === "principal").length));
    state.upstream = `P2P 網の接続待ち（${UP_NODES.map((n, i) => `${n}=${counts[i]}`).join(" ")}）`;
    return counts.every((c) => c >= UP_NODES.length - 1) ? true : undefined;
  }, 5000);
  state.upstream = "crawl 中";
  await Promise.all(UP_NODES.map(async (n) => { for (const site of UP_CRAWL[n]) await crawlSite(n, site); }));
  state.upstream = "準備完了";
}

async function setupFork(): Promise<void> {
  // 信頼の一覧はこのデモが自分の鍵で配る（demotrust.ts）。鍵は volume に残るので、再起動しても同じコーディネータになる
  const net = await setupTrustNetwork({ distribute: false, progress: (m) => (state.fork = m) });
  state.fork = "信頼の一覧を配布中";
  await initTrust(Object.fromEntries(FORK_NODES.map((n) => [n, net.pk(n)])));
  // evil-1 に偽の文書を入れる: fork-2 の本物の署名を別の URL・タイトルに付けたもの（署名が合わない）と、署名の無いもの
  state.fork = "evil-1 に偽の文書を投入中";
  const real = (await (
    await fetchAdmin(`${base("fork-2")}/solr/select?q=*:*&fq=host_s:beta.lab&fq=provenance_s:*&fl=provenance_s&rows=1&wt=json`)
  ).json()) as { response: { docs: { provenance_s: string }[] } };
  // without a real signature the "forged" document would only be an unsigned one, and the demo would show the wrong thing
  if (!real.response.docs[0]?.provenance_s) throw new Error("fork-2 has no signed document to borrow a signature from");
  const docs = [
    { sku: "http://spam.lab/forged.html", title: ["Bitcoin lightning channel (forged author)"], text_t: "bitcoin lightning channel forged page claiming fork-2 as author", provenance_s: real.response.docs[0]?.provenance_s ?? "" },
    { sku: "http://spam.lab/unsigned.html", title: ["Bitcoin lightning channel (unsigned)"], text_t: "bitcoin lightning channel page without author signature" },
  ];
  const present = (await (await fetchAdmin(`${base("evil-1")}/solr/select?q=*:*&fq=sku:${encodeURIComponent('"http://spam.lab/unsigned.html"')}&rows=0&wt=json`)).json()) as { response: { numFound: number } };
  if (present.response.numFound > 0) {
    state.fork = "準備完了";
    return;
  }
  await putFile("forged.jsonl", docs.map((d) => JSON.stringify(d)).join("\n") + "\n");
  const before = (await status("evil-1")).docs;
  await fetchAdmin(`${base("evil-1")}/IndexImportJsonList_p.html?url=${encodeURIComponent(`${LAB}/files/forged.jsonl`)}`);
  await until("evil-1 imported the forged documents", 120_000, async () => ((await status("evil-1")).docs >= before + 2 ? true : undefined));
  state.fork = "準備完了";
}

async function setup(): Promise<void> {
  const tasks = [
    setupFork().catch((e: Error) => { state.fork = `失敗: ${e.message}`; throw e; }),
    setupUpstream().catch((e: Error) => { state.upstream = `失敗: ${e.message}`; throw e; }),
  ];
  state.message = "網を組んでいます（数分〜十数分かかります）";
  try {
    await Promise.all(tasks);
    state.phase = "ready";
    state.message = "準備完了。検索できます";
    note("setup finished");
  } catch (e) {
    state.phase = "error";
    state.message = `準備に失敗しました: ${(e as Error).message}（docker compose logs で各ノードを確認してください）`;
    note(state.message);
  }
}

// ノードの状態は 5 秒ごとにまとめて取る（画面の更新はこの結果を返すだけ）
async function pollNodes(): Promise<void> {
  for (;;) {
    await Promise.all(
      [...FORK_NODES.map((n) => [n, "fork"] as const), ...UP_NODES.map((n) => [n, "upstream"] as const)].map(async ([name, side]) => {
        const s: NodeState = { name, side, role: ROLES[name], up: false, docs: 0, seniors: 0, reach: "-", type: "-", ui: ADMIN_PORTS && UI_PORTS[name] ? `http://localhost:${UI_PORTS[name]}/` : null, trust: "" };
        try {
          const st = await status(name);
          s.up = true;
          s.docs = st.docs;
          const [ps, me] = await Promise.all([peers(name), mySeed(name)]);
          s.seniors = ps.filter((p) => p.type === "senior" || p.type === "principal").length;
          s.reach = me.Reach ?? (side === "fork" ? "direct" : "-");
          s.type = me.PeerType ?? "-";
          if (side === "fork" && trustReady()) {
            const h = await held(name).catch(() => []);
            const part = (c: "A" | "B"): string => {
              const d = h.filter((x) => x.coordinator === c && x.kind === "delegation").map((x) => `委任 v${x.version}${x.revoked ? "（失効）" : ""}`);
              const l = h.filter((x) => x.coordinator === c && x.kind === "list").map((x) => `一覧 v${x.version}`);
              const used = ((view() as { modes?: Record<string, { coordinators: string[] }> }).modes?.[name]?.coordinators ?? []).includes(c);
              return d.length + l.length ? `${c}${used ? "" : "（未使用）"}: ${[...d, ...l].join(" ")}` : "";
            };
            s.trust = [part("A"), part("B")].filter(Boolean).join(" / ") || "なし";
          }
        } catch {
          // まだ起動していない
        }
        state.nodes.set(name, s);
      }),
    );
    // a node that stopped (e.g. out of memory) after the setup: say so instead of failing searches silently
    if (state.phase === "ready" || state.phase === "degraded") {
      const down = [...state.nodes.values()].filter((n) => !n.up).map((n) => n.name);
      state.phase = down.length ? "degraded" : "ready";
      state.message = down.length ? `停止しているノード: ${down.join(", ")}（docker compose -f compose.demo.yaml -p yacydemo up -d で起こし直せる）` : "準備完了。検索できます";
    }
    await sleep(5000);
  }
}

// ---- 検索
const judged = new Map<string, { relevant: Set<string>; decoys: Set<string> }>();
for (const j of judgements()) judged.set(j.query, { relevant: new Set(j.relevant), decoys: new Set(j.decoys) });

const SITE_KIND: Record<string, string> = { "spam.lab": "スパム", "ads.lab": "広告", "delta.lab": "NAT の内側" };
function crawledBy(side: "fork" | "upstream", site: string): string {
  if (side === "fork") return Object.entries(FORK_CRAWL).find(([, s]) => s === site)?.[0] ?? (site === "spam.lab" ? "evil-1" : "?");
  return Object.entries(UP_CRAWL).find(([, s]) => s.includes(site))?.[0] ?? "?";
}
function enrich(side: "fork" | "upstream", query: string, hits: Hit[]): object[] {
  const j = judged.get(query);
  return hits.map((h, i) => {
    const site = (() => { try { return new URL(h.url).host; } catch { return ""; } })();
    const judge = j?.relevant.has(h.url) ? "relevant" : j?.decoys.has(h.url) ? "decoy" : SITE_KIND[site] ? "trustsite" : "other";
    return { rank: i + 1, title: h.title, url: h.url, snippet: h.snippet, site, crawledBy: crawledBy(side, site), kind: SITE_KIND[site] ?? null, judge, verified: h.verified ?? null, trust: h.trust ?? null, tags: h.trustTags ?? "" };
  });
}

// 設定は問い合わせ元ノードごとに 1 つしか持てないので、同じノードへの検索は順に行う
const locks = new Map<string, Promise<void>>();
async function withLock<T>(node: string, f: () => Promise<T>): Promise<T> {
  const prev = locks.get(node) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => (release = r));
  locks.set(node, prev.then(() => next));
  await prev;
  try {
    return await f();
  } finally {
    release();
  }
}
const current = new Map<string, Record<string, string>>();
async function ensureConfig(node: string, cfg: Record<string, string>): Promise<void> {
  const have = current.get(node) ?? {};
  for (const [k, v] of Object.entries(cfg)) if (have[k] !== v) {
    await setConfig(node, k, v);
    have[k] = v;
  }
  current.set(node, have);
}

let round = 0;
const MAX_WAITING = 8;
let waiting = 0;
async function streamSearch(req: IncomingMessage, res: ServerResponse, p: URLSearchParams): Promise<void> {
  const side = p.get("side") === "upstream" ? "upstream" : "fork";
  const nodes = side === "fork" ? ["fork-1", "fork-2", "fork-3"] : UP_NODES;
  const origin = nodes.includes(p.get("origin") ?? "") ? p.get("origin")! : nodes[0];
  const query = (p.get("q") ?? "").trim().slice(0, 200);
  const open = p.get("open") === "1";
  const noads = p.get("noads") === "1";
  const wait = Math.min(10000, Math.max(1000, Number(p.get("wait") ?? 5000) || 5000));
  res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
  if (!query) return void res.end(JSON.stringify({ error: "クエリが空です" }) + "\n");
  if (waiting >= MAX_WAITING) return void res.end(JSON.stringify({ error: "検索が混んでいます。少し待ってからもう一度" }) + "\n");
  // the response closes when the browser goes away (the request's own close fires as soon as its body was read)
  let gone = false;
  res.on("close", () => (gone = !res.writableFinished));
  const key = `demo${++round}`; // 毎回新しい検索にする（YaCy は同じ検索を 10 分キャッシュする）
  waiting++;
  try {
    await withLock(origin, async () => {
      waiting = Math.max(0, waiting - 1);
      if (gone) return; // the browser gave up while this search waited
      if (side === "fork") await ensureConfig(origin, { "trust.search.acceptUnverified": open ? "true" : "false", "trust.policy.excludeTags": noads ? "ads" : "" });
      const t0 = Date.now();
      const first = await search(origin, query, "global", 20, key);
      res.write(JSON.stringify({ pass: 1, ms: Date.now() - t0, origin, hits: enrich(side, query, first.hits) }) + "\n");
      await sleep(Math.max(0, wait - (Date.now() - t0)));
      if (gone) return;
      let final = await search(origin, query, "global", 20, key, true);
      // YaCy can briefly list nothing while results that arrived late are still being moved into the result list
      if (final.hits.length === 0 && first.hits.length === 0) {
        await sleep(1500);
        final = await search(origin, query, "global", 20, key, true);
      }
      res.write(JSON.stringify({ pass: 2, ms: Date.now() - t0, origin, hits: enrich(side, query, final.hits) }) + "\n");
    });
  } catch (e) {
    if (!gone) res.write(JSON.stringify({ error: (e as Error).message }) + "\n");
  }
  res.end();
}

// 結果の URL（http://beta.lab/... など）はホストから名前解決できないので、lab サーバーから取って見せる
function proxyPage(res: ServerResponse, target: string): void {
  let u: URL;
  try {
    u = new URL(target);
  } catch {
    return void res.writeHead(400).end("bad url");
  }
  // only the corpus pages: the lab server also has /probe, /seed and /files, which a web page must not reach through here
  if (u.protocol !== "http:" || !CORPUS_HOSTS.has(u.hostname) || !/^\/([a-z0-9_-]+\/)*[a-z0-9_-]*(\.html)?$/.test(u.pathname) || u.search) return void res.writeHead(400).end("only corpus pages");
  const req = request({ host: "seed.lab", port: 80, path: u.pathname, headers: { host: u.hostname }, timeout: 10000 }, (up) => {
    res.writeHead(up.statusCode ?? 502, {
      "content-type": "text/html; charset=utf-8",
      // shown on the origin of the demo: no scripts, no access to the demo's API
      "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    });
    up.pipe(res);
  });
  req.on("timeout", () => req.destroy(new Error("timeout")));
  req.on("error", (e) => {
    if (!res.headersSent) res.writeHead(502);
    res.end(e.message);
  });
  req.end();
}

const CORPUS_HOSTS = new Set(["alpha.lab", "beta.lab", "gamma.lab", "spam.lab", "ads.lab", "delta.lab"]);

const PRESETS: { q: string; hint: string }[] = [
  { q: TRUST_QUERIES.spam, hint: "スパム頁。本家は網の誰かが持てば出る。改善版は既定で出さず、開放モードでも「未検証」として下に置く。偽の作者の文書は開放モードでも出ない" },
  { q: TRUST_QUERIES.ads, hint: "広告を宣言したピアの頁には ads タグが付く。「広告を除外」で消える" },
  { q: TRUST_QUERIES.nat, hint: "NAT の内側のピア（nat-1）だけが持つ頁。改善版はリレー経由で届く。本家には NAT の内側のピアに届く仕組みが無いので、本家側の網には入れていない（0 件になる）" },
];
for (const t of TOPICS) {
  const hint =
    t.lang === "en"
      ? "罠頁（1 語だけの詰め込み頁・中身の薄いタグ一覧頁）と正解の並び"
      : "日本語・中国語。本家は Solr では引けるが罠頁が上位に来る。本家の単語索引（RWI）では句読点までが 1 語になり引けない";
  const known = PRESETS.find((p) => p.q === t.query);
  if (known) known.hint += `。${hint}`;
  else PRESETS.push({ q: t.query, hint });
}

// ---- 信頼の設定（画面の「コーディネータ」の欄）
const json = (res: ServerResponse, code: number, body: unknown): void =>
  void res.writeHead(code, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }).end(JSON.stringify(body));
const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c: Buffer) => {
      body += c.toString("utf8");
      if (body.length > 65536) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        const v: unknown = body ? JSON.parse(body) : {};
        if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("a JSON object is expected");
        resolve(v as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
// 一覧の署名と配布は 1 つずつ行う
let trustQueue: Promise<unknown> = Promise.resolve();
async function trustAction(req: IncomingMessage, res: ServerResponse, action: string): Promise<void> {
  // other web pages must not drive the demo: only same-origin JSON requests
  if (!(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "JSON only" });
  if (phaseOf() !== "ready" && phaseOf() !== "degraded") return json(res, 409, { error: "準備が終わってから操作してください" });
  let body: Record<string, unknown>;
  try {
    body = await readJson(req);
  } catch {
    return json(res, 400, { error: "bad JSON" });
  }
  const onlyForkTwo = body.target === "fork-2";
  const run = async (): Promise<void> => {
    if (action === "list") await publishList((body.entries ?? {}) as Record<string, object>, onlyForkTwo);
    else if (action === "delegation") await setDelegation(body.revoked === true, onlyForkTwo);
    else if (action === "mode") {
      const node = String(body.node ?? "");
      await withLock(node, () => setMode(node, { coordinators: body.coordinators as ("A" | "B")[], fallback: body.fallback as "self" | "signedOnly" }));
    } else throw new Error(`unknown action ${action}`);
  };
  const job = trustQueue.then(run, run);
  trustQueue = job.catch(() => undefined);
  try {
    await job;
    note(`trust: ${action} ${JSON.stringify(body).slice(0, 120)}`);
    json(res, 200, view());
  } catch (e) {
    json(res, 500, { error: (e as Error).message });
  }
}
const phaseOf = (): string => state.phase;

const page = (): string => readFileSync(new URL("./demo/index.html", import.meta.url), "utf8");

/** requests from other sites: a foreign Host (DNS rebinding) or, for requests that change something, a foreign Origin */
function foreign(req: IncomingMessage): boolean {
  if (!HOSTS.has(req.headers.host ?? "")) return true;
  if (req.method === "GET") return false;
  const origin = req.headers.origin;
  return !origin || !HOSTS.has(origin.replace(/^https?:\/\//, ""));
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (foreign(req)) return void res.writeHead(403, { "content-type": "text/plain" }).end("forbidden: open the demo as http://localhost:8800/\n");
  if (url.pathname === "/") return void res.writeHead(200, { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY" }).end(page());
  // the mock mode of the page (the same files are published on GitHub Pages)
  if (url.pathname === "/mock.js" || url.pathname === "/mock-data.json") {
    const file = new URL("./demo" + url.pathname, import.meta.url);
    if (!existsSync(file)) return void res.writeHead(404).end("not found");
    const type = url.pathname.endsWith(".js") ? "text/javascript; charset=utf-8" : "application/json; charset=utf-8";
    return void res.writeHead(200, { "content-type": type, "cache-control": "no-store" }).end(readFileSync(file));
  }
  if (url.pathname === "/api/state") {
    const nodes = [...FORK_NODES, ...UP_NODES].map((n) => state.nodes.get(n)).filter(Boolean);
    return void res
      .writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" })
      .end(JSON.stringify({ phase: state.phase, message: state.message, fork: state.fork, upstream: state.upstream, log: state.log.slice(-12), nodes, presets: PRESETS }));
  }
  // a search changes the settings of the searching node (open mode, excluded tags): POST only, so that other sites
  // cannot trigger it with a link or an image
  if (url.pathname === "/api/search" && req.method === "POST")
    return void readJson(req).then(
      (b) =>
        streamSearch(req, res, new URLSearchParams(Object.entries(b).map(([k, v]) => [k, String(v)]))).catch((e) => {
          note(`search failed: ${(e as Error).message}`);
          if (!res.headersSent) json(res, 500, { error: (e as Error).message });
          else res.end();
        }),
      () => json(res, 400, { error: "bad JSON" }),
    );
  if (url.pathname === "/api/trust" && req.method === "GET") return void json(res, 200, view());
  if (url.pathname.startsWith("/api/trust/") && req.method === "POST")
    return void trustAction(req, res, url.pathname.slice("/api/trust/".length)).catch((e) => {
      if (!res.headersSent) json(res, 500, { error: (e as Error).message });
    });
  if (url.pathname === "/page") return proxyPage(res, url.searchParams.get("url") ?? "");
  res.writeHead(404).end("not found");
}).listen(PORT, () => note(`demo on :${PORT}`));

void pollNodes();
void setup();
