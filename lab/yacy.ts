// YaCy ノードを HTTP で操作する最小のクライアント。管理系 (*_p.html) は Digest 認証。
import { createHash, randomBytes } from "node:crypto";

const USER = process.env.YACY_ADMIN_USER ?? "admin";
const PASSWORD = process.env.YACY_ADMIN_PASSWORD ?? "yacy"; // docker/Dockerfile が初期値として焼き込む

const md5 = (s: string): string => createHash("md5").update(s).digest("hex");

// Node の fetch は Digest を持たないので、1 往復目の challenge から Authorization を組み立てる
export async function fetchAdmin(url: string, init: { method?: "GET" | "POST"; body?: URLSearchParams } = {}): Promise<Response> {
  const method = init.method ?? "GET";
  const first = await fetch(url, { method, body: init.body });
  if (first.status !== 401) return first;
  await first.arrayBuffer();
  const challenge = first.headers.get("www-authenticate") ?? "";
  const param = (name: string): string => challenge.match(new RegExp(`${name}="([^"]*)"`))?.[1] ?? "";
  const realm = param("realm");
  const nonce = param("nonce");
  const qop = param("qop");
  const { pathname, search } = new URL(url);
  const uri = pathname + search;
  const cnonce = randomBytes(8).toString("hex");
  const nc = "00000001";
  const ha1 = md5(`${USER}:${realm}:${PASSWORD}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = qop ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${nonce}:${ha2}`);
  const header =
    `Digest username="${USER}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="${response}"` +
    (qop ? `, qop=auth, nc=${nc}, cnonce="${cnonce}"` : "");
  return fetch(url, { method, body: init.body, headers: { Authorization: header } });
}

// 設定値を実行中のノードへ書き込む。ConfigProperties_p は POST と transactionToken（CSRF 対策）を要求する。
// token は GET の応答ヘッダ X-YaCy-Transaction-Token で渡される
export async function setConfig(node: string, key: string, value: string): Promise<void> {
  const url = `${base(node)}/ConfigProperties_p.html`;
  const page = await fetchAdmin(url);
  await page.arrayBuffer();
  const token = page.headers.get("x-yacy-transaction-token");
  if (!token) throw new Error(`${node}: no X-YaCy-Transaction-Token header from ConfigProperties_p.html`);
  const res = await fetchAdmin(url, { method: "POST", body: new URLSearchParams({ key, value, transactionToken: token }) });
  await res.arrayBuffer();
  if (!res.ok) throw new Error(`${node}: setting ${key} failed with HTTP ${res.status}`);
}

// ノード名から URL。NAT の内側のノードは名前解決できないので、アドレスを直接指定できるようにする
const ADDRESSES: Record<string, string> = { "nat-1": "172.31.0.10" };
export const base = (node: string): string => `http://${ADDRESSES[node] ?? node}:8090`;

export async function startCrawl(node: string, startUrl: string): Promise<string> {
  const params = new URLSearchParams({
    crawlingstart: "",
    crawlingMode: "url",
    crawlingURL: startUrl,
    crawlingDepth: "1",
    range: "domain",
    indexText: "on",
    indexMedia: "off",
    deleteold: "off",
  });
  const html = await (await fetchAdmin(`${base(node)}/Crawler_p.html?${params}`)).text();
  return html.replace(/<[^>]*>/g, " ").match(/Crawling of "[^"]*" (started|failed[^/]*)/)?.[0] ?? "no crawl message in response";
}

export type Status = { docs: number; rwi: number; loader: number; localCrawler: number };

export async function status(node: string): Promise<Status> {
  const xml = await (await fetchAdmin(`${base(node)}/api/status_p.xml`)).text();
  const num = (tag: string, scope = xml): number => Number(scope.match(new RegExp(`<${tag}>\\s*(\\d+)`))?.[1] ?? 0);
  const section = (tag: string): string => xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1] ?? "";
  return { docs: num("urlpublictext"), rwi: num("rwipublictext"), loader: num("size", section("loaderqueue")), localCrawler: num("size", section("localcrawlerqueue")) };
}

export type Peer = { hash: string; name: string; type: string; ip: string; fields: Record<string, string> };

// 自ピアから見えている他ピア（自分を除く）。fields は seed の全項目
export async function peers(node: string): Promise<Peer[]> {
  const json = (await (await fetch(`${base(node)}/yacy/seedlist.json?me=false`)).json()) as { peers: Record<string, string>[] };
  return json.peers.map((p) => ({ hash: p.Hash, name: p.Name, type: p.PeerType, ip: p.IP, fields: p }));
}

// 自ピアの seed
export async function mySeed(node: string): Promise<Record<string, string>> {
  const json = (await (await fetch(`${base(node)}/yacy/seedlist.json?my=`)).json()) as { peers: Record<string, string>[] };
  return json.peers[0];
}

export type Hit = { title: string; url: string; snippet: string; verified?: string; trust?: string; trustTags?: string };

// cacheKey: YaCy は同じクエリの SearchEvent を最大 10 分キャッシュする。設定を切り替えた後に同じクエリを
// 投げ直すと古い結果が返るので、どの URL にも一致しない prefer パターンを変えてキャッシュの鍵だけを変える
// resort: YaCy の結果は取り出した順に固定され、後から届いた結果は後ろに付く。2 回目の取得で順位どおりに並べ直させる
export async function search(node: string, query: string, resource: "global" | "local", rows = 10, cacheKey = "", resort = false): Promise<{ total: number; hits: Hit[] }> {
  const params = new URLSearchParams({ query, resource, maximumRecords: String(rows), verify: "false", timezoneOffset: "0", nav: "none" });
  if (resort) params.set("resortCachedResults", "true");
  if (cacheKey) params.set("prefermaskfilter", `\\Qnever-matches-${cacheKey}\\E`);
  const res = await fetch(`${base(node)}/yacysearch.json?${params}`);
  if (!res.ok) throw new Error(`search ${node} ${query}: HTTP ${res.status}`);
  type Item = { title: string; link: string; description: string; verified?: string; trust?: string; trustTags?: string };
  const channel = ((await res.json()) as { channels: { totalResults: string; items: Item[] }[] }).channels[0];
  const strip = (s: string): string => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();
  return {
    total: Number(channel.totalResults),
    hits: channel.items.map((i) => ({ title: strip(i.title), url: i.link, snippet: strip(i.description), verified: i.verified, trust: i.trust, trustTags: i.trustTags })),
  };
}
