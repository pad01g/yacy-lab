// 信頼・NAT 越えの網を組む部分。試験（trust.ts）とデモ（demo.ts）が共有する。
//   ノードの起動待ち → コーディネータ鍵・オペレータ鍵を作って信頼の一覧を配る → P2P 網の接続待ち → crawl
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { buildCorpus, buildTrustCorpus } from "./corpus.ts";
import { base, fetchAdmin, mySeed, peers, setConfig, startCrawl, status } from "./yacy.ts";

export const PUBLIC = ["fork-1", "fork-2", "fork-3", "ads-1", "evil-1"];
export const ALL = [...PUBLIC, "nat-1"];
export const ORIGIN = "fork-1";
export const LAB = "http://seed.lab";
export const NETWORK = "lab-trust";
export const CRAWL: Record<string, string> = {
  "fork-1": "alpha.lab",
  "fork-2": "beta.lab",
  "fork-3": "gamma.lab",
  "ads-1": "ads.lab",
  "evil-1": "spam.lab",
  "nat-1": "delta.lab",
};

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const log = (...a: unknown[]): void => console.error(new Date().toISOString().slice(11, 19), ...a);

export async function until<T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>, everyMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await sleep(everyMs);
  }
}

// ---- 信頼の一覧（docs/trust-and-nat.md §3 の封筒）
const b64u = (b: Buffer): string => b.toString("base64url");
export type Key = { priv: KeyObject; pk: string };
export function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey, pk: publicKey.export({ format: "jwk" }).x as string };
}
function envelope(by: Key, payload: object): object {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return { payload: b64u(bytes), signer: by.pk, sig: b64u(sign(null, bytes, by.priv)) };
}
export type Member = { pk: string; priority: number; tags: string[] };
export const delegation = (by: Key, op: Key, version: number, revoked = false): object =>
  envelope(by, { type: "yacy-delegation-v1", network: NETWORK, operator: op.pk, version, revoked });
export const peerList = (by: Key, version: number, members: Member[]): object =>
  envelope(by, { type: "yacy-peerlist-v1", network: NETWORK, version, peers: members });

export async function putFile(name: string, body: string): Promise<void> {
  const res = await fetch(`${LAB}/files/${name}`, { method: "PUT", body });
  if (!res.ok) throw new Error(`PUT ${name}: HTTP ${res.status}`);
}

export async function trustBundle(node: string): Promise<{ lists: number[]; delegations: { version: number; revoked: boolean }[] }> {
  const json = (await (await fetch(`${base(node)}/yacy/trust.json`)).json()) as { envelopes: { payload: string }[] };
  const lists: number[] = [];
  const delegations: { version: number; revoked: boolean }[] = [];
  for (const e of json.envelopes) {
    const p = JSON.parse(Buffer.from(e.payload, "base64url").toString("utf8")) as { type: string; version: number; revoked?: boolean };
    if (p.type === "yacy-peerlist-v1") lists.push(p.version);
    else delegations.push({ version: p.version, revoked: p.revoked === true });
  }
  return { lists, delegations };
}

export type TrustNetwork = {
  seeds: Record<string, Record<string, string>>;
  pk: (node: string) => string;
  coordinator: Key;
  operator: Key;
  /** fork-1..3 と nat-1 は優先度 100、ads-1 は 80 で ads タグ。evil-1 は載せない */
  members: (without?: string[]) => Member[];
  /** fork-1 から見た nat-1 の seed */
  natSeen: Awaited<ReturnType<typeof peers>>[number];
};

/** 1〜4: ノードの起動待ち、一覧の配布（fork-1 だけに URL で渡す）、網の接続待ち、crawl */
export async function setupTrustNetwork(opts: { skipCrawl?: boolean; keepExisting?: boolean; progress?: (msg: string) => void } = {}): Promise<TrustNetwork> {
  const progress = opts.progress ?? ((m: string) => log(m));
  // 1. ノードの起動
  for (const n of ALL) await until(`${n} up`, 300_000, async () => ((await status(n)) ? true : undefined));
  const seeds: Record<string, Record<string, string>> = {};
  for (const n of ALL) seeds[n] = await mySeed(n);
  const pk = (n: string): string => seeds[n].PK;
  log("peer keys", Object.fromEntries(ALL.map((n) => [n, `${seeds[n].Hash} ${pk(n)?.slice(0, 10)}…`])));

  // 2. 信頼の一覧を作って配る。URL を渡すのは全ノードだが、一覧を置くのは lab サーバー 1 か所
  progress("信頼の一覧を配布中");
  const coordinator = newKey();
  const operator = newKey();
  const members = (without: string[] = []): Member[] =>
    [
      ...["fork-1", "fork-2", "fork-3", "nat-1"].map((n) => ({ pk: pk(n), priority: 100, tags: [] as string[] })),
      { pk: pk("ads-1"), priority: 80, tags: ["ads"] },
    ].filter((m) => !without.some((w) => pk(w) === m.pk));
  // keepExisting（デモの再起動）: ノードがすでに一覧を持っていれば鍵を作り直さない（作り直すと別のコーディネータになる）
  const existing = opts.keepExisting ? await trustBundle(ORIGIN).catch(() => undefined) : undefined;
  if (existing && existing.lists.length > 0) {
    log("nodes already have a trust list; keeping it");
  } else await putFile("bundle-v1.json", JSON.stringify({ envelopes: [delegation(coordinator, operator, 1), peerList(operator, 1, members())] }));
  for (const n of existing && existing.lists.length > 0 ? [] : ALL) {
    await setConfig(n, "trust.coordinators", coordinator.pk);
    await setConfig(n, "trust.bundle.urls", `${LAB}/files/bundle-v1.json`);
  }

  // 3. P2P 網: 公開側のノードは互いを senior として知り、fork-1 は nat-1 をリレー経由の senior として知る
  await until("public peers connected", 600_000, async () => {
    const counts = await Promise.all(PUBLIC.map(async (n) => (await peers(n)).filter((p) => p.type === "senior" || p.type === "principal").length));
    const line = PUBLIC.map((n, i) => `${n}=${counts[i]}`).join(" ");
    log("senior peers seen:", line);
    progress(`P2P 網の接続待ち（見えている senior ピア数: ${line}）`);
    return counts.every((c) => c >= PUBLIC.length - 1) ? true : undefined;
  }, 5000);
  const natSeen = await until("fork-1 sees nat-1 through the relay", 600_000, async () => {
    const p = (await peers(ORIGIN)).find((x) => x.hash === seeds["nat-1"].Hash);
    log("nat-1 as seen by fork-1:", p ? `${p.type} Reach=${p.fields.Reach ?? "-"}` : "unknown");
    progress(`NAT の内側の nat-1 がリレー経由で見えるのを待機中（${p ? `${p.type} Reach=${p.fields.Reach ?? "-"}` : "未発見"}）`);
    return p && (p.type === "senior" || p.type === "principal") && p.fields.Reach === "relay" ? p : undefined;
  }, 10000);

  // 4. crawl
  if (!opts.skipCrawl) {
    progress("crawl 中");
    await Promise.all(ALL.map((n) => crawlSite(n, CRAWL[n])));
  }
  return { seeds, pk, coordinator, operator, members, natSeen };
}

/** node に site を crawl させ、その site の全頁（+ 目次頁）が索引に入るまで待つ */
export async function crawlSite(node: string, site: string): Promise<void> {
  const corpusPages = [...buildCorpus(), ...buildTrustCorpus()].filter((p) => p.site === site).length;
  // already indexed (e.g. the demo was restarted): crawling again would not add documents
  const have = (await (await fetchAdmin(`${base(node)}/solr/select?q=*:*&fq=host_s:${encodeURIComponent(site)}&rows=0&wt=json`)).json()) as { response: { numFound: number } };
  if (have.response.numFound >= corpusPages) {
    log(node, "already has", site, have.response.numFound);
    return;
  }
  const before = (await status(node)).docs;
  log(node, await startCrawl(node, `http://${site}/`));
  const expected = before + corpusPages + 1; // + 目次頁
  await until(`${node} index ${site}`, 600_000, async () => {
    const s = await status(node);
    return s.docs >= expected && s.loader === 0 && s.localCrawler === 0 ? s : undefined;
  });
  log(node, "indexed", site, await status(node));
}
