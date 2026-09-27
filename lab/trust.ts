// 身元・信頼・NAT 越えの試験（compose.trust.yaml）。docs/trust-and-nat.md の §10 の確認項目を順に実行する。
//   docker compose -f compose.trust.yaml -p yacytrust run --rm runner [--skip-crawl]
// 各項目を PASS / FAIL で記録し、results/trust-<時刻>.md に保存する。1 つでも FAIL なら終了コード 1。
import { createHash, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildCorpus, buildTrustCorpus, TRUST_QUERIES } from "./corpus.ts";
import { base, fetchAdmin, mySeed, peers, search, setConfig, startCrawl, status, type Hit } from "./yacy.ts";

const { values } = parseArgs({ options: { "skip-crawl": { type: "boolean", default: false } } });

const PUBLIC = ["fork-1", "fork-2", "fork-3", "ads-1", "evil-1"];
const ALL = [...PUBLIC, "nat-1"];
const ORIGIN = "fork-1";
const LAB = "http://seed.lab";
const CRAWL: Record<string, string> = {
  "fork-1": "alpha.lab",
  "fork-2": "beta.lab",
  "fork-3": "gamma.lab",
  "ads-1": "ads.lab",
  "evil-1": "spam.lab",
  "nat-1": "delta.lab",
};

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.error(new Date().toISOString().slice(11, 19), ...a);

async function until<T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>, everyMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await sleep(everyMs);
  }
}

// ---- 結果の記録
type Check = { id: string; title: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(id: string, title: string, ok: boolean, detail: string): void {
  checks.push({ id, title, ok, detail });
  log(ok ? "PASS" : "FAIL", id, title, "-", detail);
}

// ---- 信頼の一覧（docs/trust-and-nat.md §3 の封筒）
const b64u = (b: Buffer): string => b.toString("base64url");
type Key = { priv: KeyObject; pk: string };
function newKey(): Key {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { priv: privateKey, pk: publicKey.export({ format: "jwk" }).x as string };
}
function envelope(by: Key, payload: object): object {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  return { payload: b64u(bytes), signer: by.pk, sig: b64u(sign(null, bytes, by.priv)) };
}
const NETWORK = "lab-trust";
const delegation = (by: Key, op: Key, version: number, revoked = false): object =>
  envelope(by, { type: "yacy-delegation-v1", network: NETWORK, operator: op.pk, version, revoked });
const peerList = (by: Key, version: number, peers: { pk: string; priority: number; tags: string[] }[]): object =>
  envelope(by, { type: "yacy-peerlist-v1", network: NETWORK, version, peers });

async function putFile(name: string, body: string): Promise<void> {
  const res = await fetch(`${LAB}/files/${name}`, { method: "PUT", body });
  if (!res.ok) throw new Error(`PUT ${name}: HTTP ${res.status}`);
}

async function trustBundle(node: string): Promise<{ lists: number[]; delegations: { version: number; revoked: boolean }[] }> {
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

// ---- 検索
let queryRound = 0;
async function globalSearch(query: string, rows = 20): Promise<Hit[]> {
  const key = `t${++queryRound}`;
  await search(ORIGIN, query, "global", rows, key).catch(() => undefined);
  await sleep(7000);
  return (await search(ORIGIN, query, "global", rows, key, true)).hits;
}
const siteOf = (h: Hit): string => new URL(h.url).host;
const summary = (hits: Hit[]): string => hits.map((h) => `${siteOf(h)}${h.verified === "false" ? "(unverified)" : ""}${h.trustTags ? `[${h.trustTags}]` : ""}`).join(" ") || "(no results)";

async function main(): Promise<void> {
  // 1. ノードの起動
  for (const n of ALL) await until(`${n} up`, 300_000, async () => ((await status(n)) ? true : undefined));
  const seeds: Record<string, Record<string, string>> = {};
  for (const n of ALL) seeds[n] = await mySeed(n);
  const pk = (n: string): string => seeds[n].PK;
  log("peer keys", Object.fromEntries(ALL.map((n) => [n, `${seeds[n].Hash} ${pk(n)?.slice(0, 10)}…`])));

  // 2. 信頼の一覧を作って配る: fork-1..3 と nat-1 は優先度 100、ads-1 は 80 で ads タグ。evil-1 は載せない
  const coordinator = newKey();
  const operator = newKey();
  const members = (without: string[] = []) =>
    [
      ...["fork-1", "fork-2", "fork-3", "nat-1"].map((n) => ({ pk: pk(n), priority: 100, tags: [] as string[] })),
      { pk: pk("ads-1"), priority: 80, tags: ["ads"] },
    ].filter((m) => !without.some((w) => pk(w) === m.pk));
  await putFile("bundle-v1.json", JSON.stringify({ envelopes: [delegation(coordinator, operator, 1), peerList(operator, 1, members())] }));
  for (const n of ALL) {
    await setConfig(n, "trust.coordinators", coordinator.pk);
    await setConfig(n, "trust.bundle.urls", `${LAB}/files/bundle-v1.json`);
  }

  // 3. P2P 網: 公開側のノードは互いを senior として知り、fork-1 は nat-1 をリレー経由の senior として知る
  await until("public peers connected", 600_000, async () => {
    const counts = await Promise.all(PUBLIC.map(async (n) => (await peers(n)).filter((p) => p.type === "senior" || p.type === "principal").length));
    log("senior peers seen:", PUBLIC.map((n, i) => `${n}=${counts[i]}`).join(" "));
    return counts.every((c) => c >= PUBLIC.length - 1) ? true : undefined;
  }, 5000);
  const natSeen = await until("fork-1 sees nat-1 through the relay", 600_000, async () => {
    const p = (await peers(ORIGIN)).find((x) => x.hash === seeds["nat-1"].Hash);
    log("nat-1 as seen by fork-1:", p ? `${p.type} Reach=${p.fields.Reach ?? "-"}` : "unknown");
    return p && (p.type === "senior" || p.type === "principal") && p.fields.Reach === "relay" ? p : undefined;
  }, 10000);

  // 4. crawl
  if (!values["skip-crawl"]) {
    const corpus = buildCorpus();
    await Promise.all(
      ALL.map(async (n) => {
        const site = CRAWL[n];
        log(n, await startCrawl(n, `http://${site}/`));
        const trustPages = buildTrustCorpus();
        const expected =
          (["alpha.lab", "beta.lab", "gamma.lab"].includes(site) ? corpus.filter((p) => p.site === site).length : trustPages.filter((p) => p.site === site).length) + 1; // + 目次頁
        await until(`${n} index ${site}`, 600_000, async () => {
          const s = await status(n);
          return s.docs >= expected && s.loader === 0 && s.localCrawler === 0 ? s : undefined;
        });
        log(n, "indexed", site, await status(n));
      }),
    );
  }

  // 5. evil-1 に偽の文書を入れる: fork-2 の本物の署名を別の URL・タイトルに付けたもの（INVALID）と、署名の無いもの（UNSIGNED）
  const real = (await (
    await fetchAdmin(`${base("fork-2")}/solr/select?q=*:*&fq=host_s:beta.lab&fq=provenance_s:*&fl=sku,title,provenance_s&rows=1&wt=json`)
  ).json()) as { response: { docs: { sku: string; title: string[]; provenance_s: string }[] } };
  const realDoc = real.response.docs[0];
  check("S0", "fork-2 の索引の文書に作者の署名が付いている", !!realDoc?.provenance_s?.startsWith(`1|${pk("fork-2")}|`), realDoc ? realDoc.provenance_s.slice(0, 60) + "…" : "no document");
  const forged = [
    { sku: "http://spam.lab/forged.html", title: ["Bitcoin lightning channel (forged author)"], text_t: "bitcoin lightning channel forged page claiming fork-2 as author", provenance_s: realDoc?.provenance_s ?? "" },
    { sku: "http://spam.lab/unsigned.html", title: ["Bitcoin lightning channel (unsigned)"], text_t: "bitcoin lightning channel page without author signature" },
  ];
  await putFile("forged.jsonl", forged.map((d) => JSON.stringify(d)).join("\n") + "\n");
  const before = (await status("evil-1")).docs;
  await fetchAdmin(`${base("evil-1")}/IndexImportJsonList_p.html?url=${encodeURIComponent(`${LAB}/files/forged.jsonl`)}`);
  await until("evil-1 imported the forged documents", 120_000, async () => ((await status("evil-1")).docs >= before + 2 ? true : undefined));
  const inEvil = (await (
    await fetchAdmin(`${base("evil-1")}/solr/select?q=*:*&fq=sku:${encodeURIComponent('"http://spam.lab/forged.html"')}&fl=sku,provenance_s&wt=json`)
  ).json()) as { response: { docs: { provenance_s?: string }[] } };
  check("S1", "作者を偽った文書が、流用した署名付きのまま evil-1 の索引にある", inEvil.response.docs[0]?.provenance_s === realDoc?.provenance_s, JSON.stringify(inEvil.response.docs[0] ?? {}).slice(0, 120));

  // 信頼ピア（fork-2）の索引に、信頼集合外の作者（evil-1）が署名した文書を入れる。fork-2 は検索先になるので、
  // この文書が出ないことは「問い合わせ先から外れたから」ではなく「作者の署名で落とした」ことを示す
  const evilDoc = (await (
    await fetchAdmin(`${base("evil-1")}/solr/select?q=*:*&fq=host_s:spam.lab&fq=provenance_s:*&fq=title:bitcoin&fq=-title:forged&fl=sku,title,text_t,provenance_s&rows=1&wt=json`)
  ).json()) as { response: { docs: { sku: string; title: string[]; text_t?: string; provenance_s: string }[] } };
  const relayed = evilDoc.response.docs[0];
  if (!relayed) throw new Error("evil-1 has no signed spam.lab document");
  await putFile("relayed.jsonl", JSON.stringify({ sku: relayed.sku, title: relayed.title, text_t: relayed.text_t ?? "bitcoin lightning channel", provenance_s: relayed.provenance_s }) + "\n");
  const beforeFork2 = (await status("fork-2")).docs;
  await fetchAdmin(`${base("fork-2")}/IndexImportJsonList_p.html?url=${encodeURIComponent(`${LAB}/files/relayed.jsonl`)}`);
  await until("fork-2 imported the relayed document", 120_000, async () => ((await status("fork-2")).docs >= beforeFork2 + 1 ? true : undefined));
  const inFork2 = (await (
    await fetchAdmin(`${base("fork-2")}/solr/select?q=*:*&fq=sku:${encodeURIComponent(JSON.stringify(relayed.sku))}&fl=sku,provenance_s&wt=json`)
  ).json()) as { response: { docs: { provenance_s?: string }[] } };
  check("S2", "evil-1 が署名した文書が、そのまま信頼ピア fork-2 の索引にある", inFork2.response.docs[0]?.provenance_s === relayed.provenance_s, `${relayed.sku} ${(relayed.provenance_s ?? "").slice(0, 40)}…`);

  // ---- 確認
  // C1 seed の署名
  const seen = await peers(ORIGIN);
  const signedAll = PUBLIC.filter((n) => n !== ORIGIN).every((n) => {
    const p = seen.find((x) => x.hash === seeds[n].Hash);
    return p && p.fields.PK === pk(n) && !!p.fields.Sig;
  });
  // YaCy のピア ID = base64url(SHA-256(公開鍵 32 byte)) の先頭 12 文字
  const hashOf = (pk: string): string => createHash("sha256").update(Buffer.from(pk, "base64url")).digest("base64url").slice(0, 12);
  const derived = PUBLIC.filter((n) => n !== ORIGIN).every((n) => hashOf(pk(n)) === seeds[n].Hash);
  check("C1", "他ピアの seed が署名付きで、ピア ID が公開鍵から導かれている", signedAll && derived, seen.map((p) => `${p.name}:${p.fields.PK ? "signed" : "UNSIGNED"}:${p.fields.PK && hashOf(p.fields.PK) === p.hash ? "hash=H(PK)" : "HASH MISMATCH"}`).join(" "));

  // C2 一覧の取り込み
  const b1 = await until("fork-1 has the trust list", 180_000, async () => {
    const b = await trustBundle(ORIGIN);
    return b.lists.includes(1) ? b : undefined;
  });
  check("C2", "fork-1 が一覧 v1 を取り込んだ", b1.lists.includes(1) && b1.delegations.length === 1, JSON.stringify(b1));

  // C3 既定: 信頼集合外（evil-1）の頁は出ない
  const spamDefault = await globalSearch(TRUST_QUERIES.spam);
  const trustedSites = new Set(["alpha.lab", "beta.lab", "gamma.lab"]);
  check(
    "C3",
    "既定では信頼集合外の作者（spam.lab）の結果が出ない",
    spamDefault.length >= 3 && spamDefault.every((h) => trustedSites.has(siteOf(h)) && h.verified === "true"),
    summary(spamDefault),
  );
  check("C3b", "信頼ピア（fork-2）が持っていても、信頼集合外の作者が署名した文書は出ない", !spamDefault.some((h) => h.url === relayed.sku), `${relayed.sku} ${spamDefault.some((h) => h.url === relayed.sku) ? "SHOWN" : "not shown"}`);

  // C4 開放モード: 未検証として後ろに出る。偽の作者の文書は出ない。
  // 取り込んだ偽の文書は evil-1 の Solr にしか無い。evil-1 が DHT 検索先に選ばれると Solr の問い合わせ先から外れるので、
  // この間は DHT 検索の最低年齢を 3 日に戻し、全ピアに Solr で問い合わせる
  await setConfig(ORIGIN, "trust.search.acceptUnverified", "true");
  await setConfig(ORIGIN, "remotesearch.dht.minage", "3");
  const spamOpen = await globalSearch(TRUST_QUERIES.spam, 30);
  await setConfig(ORIGIN, "remotesearch.dht.minage", "0");
  await setConfig(ORIGIN, "trust.search.acceptUnverified", "false");
  const firstUnverified = spamOpen.findIndex((h) => h.verified !== "true");
  const lastVerified = spamOpen.map((h) => h.verified === "true").lastIndexOf(true);
  const spamHits = spamOpen.filter((h) => siteOf(h) === "spam.lab");
  check("C4a", "開放モードでは spam.lab が「未検証」として出る", spamHits.length > 0 && spamHits.every((h) => h.verified === "false"), summary(spamOpen));
  check("C4b", "未検証の結果は検証済みの結果より必ず下", firstUnverified === -1 || lastVerified < firstUnverified, `last verified #${lastVerified}, first unverified #${firstUnverified}`);
  check("C4c", "作者を偽った文書（署名の流用）は開放モードでも出ない", !spamOpen.some((h) => h.url.includes("forged")), spamOpen.filter((h) => h.url.includes("forged")).map((h) => h.url).join(" ") || "absent");
  check("C4d", "署名の無い文書は開放モードでだけ「未検証」で出る", spamOpen.some((h) => h.url.includes("unsigned") && h.verified === "false") && !spamDefault.some((h) => h.url.includes("unsigned")), "unsigned.html");
  check("C4e", "C3b の対照: 開放モードなら fork-2 の持つ evil-1 作者の文書は「未検証」で出る", spamOpen.some((h) => h.url === relayed.sku && h.verified === "false"), relayed.sku);

  // C5 宣言タグ
  const adsDefault = await globalSearch(TRUST_QUERIES.ads);
  const adsHits = adsDefault.filter((h) => siteOf(h) === "ads.lab");
  check("C5a", "ads を宣言した信頼ピアの結果に ads タグが付く", adsHits.length > 0 && adsHits.every((h) => h.verified === "true" && (h.trustTags ?? "").split(" ").includes("ads")), summary(adsDefault));
  await setConfig(ORIGIN, "trust.policy.excludeTags", "ads");
  const adsExcluded = await globalSearch(TRUST_QUERIES.ads);
  await setConfig(ORIGIN, "trust.policy.excludeTags", "");
  check("C5b", "excludeTags=ads で ads の作者の結果が消える", !adsExcluded.some((h) => siteOf(h) === "ads.lab") && adsExcluded.length > 0, summary(adsExcluded));

  // C6 NAT 越え
  const probeYacy = (await (await fetch(`${LAB}/probe?target=172.31.0.10:8090`)).json()) as { reachable: boolean };
  const probeP2p = (await (await fetch(`${LAB}/probe?target=172.31.0.10:4001`)).json()) as { reachable: boolean };
  check("C6a", "公開側から nat-1 の YaCy（8090）にも libp2p（4001）にも直接は届かない", !probeYacy.reachable && !probeP2p.reachable, JSON.stringify([probeYacy, probeP2p]));
  check("C6b", "nat-1 の seed は Reach=relay で、リレー経由のアドレスを持つ", natSeen.fields.Reach === "relay" && (natSeen.fields.P2PA ?? "").includes("/p2p-circuit"), `Reach=${natSeen.fields.Reach} P2PA=${(natSeen.fields.P2PA ?? "").slice(0, 80)}…`);
  check("C6c", "nat-1 は DHT の保存先を申し出ていない（RDS なし）", !natSeen.fields.RDS, `RDS=${natSeen.fields.RDS ?? "-"}`);
  const natDefault = await globalSearch(TRUST_QUERIES.nat);
  check("C6d", "fork-1 の global 検索で nat-1 だけが持つ delta.lab の頁が見つかる", natDefault.some((h) => siteOf(h) === "delta.lab"), summary(natDefault));
  // leecher にすると外から届かなくなる
  await setConfig("nat-1", "p2p.mode", "leecher");
  await until("fork-1 sees nat-1 as leecher", 240_000, async () => {
    const p = (await peers(ORIGIN)).find((x) => x.hash === seeds["nat-1"].Hash);
    return !p || p.fields.Reach === "none" ? true : undefined;
  }, 10000);
  const natLeecher = await globalSearch(TRUST_QUERIES.nat);
  const control = await globalSearch(TRUST_QUERIES.spam);
  check(
    "C6e",
    "nat-1 を leecher にすると delta.lab の頁は見つからない（同じ時点で他のクエリは結果が出る）",
    !natLeecher.some((h) => siteOf(h) === "delta.lab") && control.some((h) => siteOf(h) === "beta.lab"),
    `nat: ${summary(natLeecher)} / control: ${summary(control)}`,
  );
  await setConfig("nat-1", "p2p.mode", "auto");

  // C9 公開側のピアはリレー経由にならない（到達できるピアが Reach=relay に張り付かない）
  const publicReach = (await peers(ORIGIN)).filter((p) => ["fork-2", "fork-3", "ads-1", "evil-1"].some((n) => seeds[n].Hash === p.hash));
  const myReach = (await mySeed(ORIGIN)).Reach ?? "direct";
  check(
    "C9",
    "公開側のピアはリレー経由（Reach=relay）にならない",
    myReach !== "relay" && publicReach.length === 4 && publicReach.every((p) => (p.fields.Reach ?? "direct") !== "relay"),
    `fork-1=${myReach} ` + publicReach.map((p) => `${p.name}=${p.fields.Reach ?? "direct"}`).join(" "),
  );

  // C7 版の交換: v2（fork-3 を外す）を fork-2 にだけ渡す。fork-1 はピア間の交換で v2 を知る
  await putFile("bundle-v2.json", JSON.stringify({ envelopes: [delegation(coordinator, operator, 1), peerList(operator, 2, members(["fork-3"]))] }));
  await setConfig("fork-2", "trust.bundle.urls", `${LAB}/files/bundle-v2.json`);
  const b2 = await until("fork-1 learns list v2 from fork-2", 420_000, async () => {
    const b = await trustBundle(ORIGIN);
    return b.lists.includes(2) ? b : undefined;
  }, 10000).catch(() => undefined);
  check("C7a", "fork-1 は URL を変えていないのに、ピア間の交換で一覧 v2 を取り込む", !!b2, JSON.stringify(b2 ?? (await trustBundle(ORIGIN))));
  const afterV2 = await globalSearch(TRUST_QUERIES.spam);
  check("C7b", "v2 で外した fork-3 の頁（gamma.lab）が出なくなる", !afterV2.some((h) => siteOf(h) === "gamma.lab") && afterV2.some((h) => siteOf(h) === "beta.lab"), summary(afterV2));

  // C8 失効: コーディネータがオペレータへの委任を失効させる（v2, revoked）。alpha（fork-1 自身）にも正解があるクエリで比べる
  const beforeRevoke = await globalSearch(TRUST_QUERIES.revoke);
  check("C8a", "失効の前は自ピア以外（beta.lab）の結果も出る（C8b の対照）", beforeRevoke.some((h) => siteOf(h) === "alpha.lab") && beforeRevoke.some((h) => siteOf(h) === "beta.lab"), summary(beforeRevoke));
  await putFile("bundle-v3.json", JSON.stringify({ envelopes: [delegation(coordinator, operator, 2, true), peerList(operator, 2, members(["fork-3"]))] }));
  await setConfig("fork-2", "trust.bundle.urls", `${LAB}/files/bundle-v3.json`);
  const b3 = await until("fork-1 learns the revocation", 420_000, async () => {
    const b = await trustBundle(ORIGIN);
    return b.delegations.some((d) => d.revoked) ? b : undefined;
  }, 10000).catch(() => undefined);
  const afterRevoke = await globalSearch(TRUST_QUERIES.revoke);
  check(
    "C8b",
    "委任を失効させると、そのオペレータの一覧のピアの結果が消え、自ピアの結果だけが残る",
    !!b3 && afterRevoke.length > 0 && afterRevoke.every((h) => siteOf(h) === "alpha.lab"),
    `${JSON.stringify(b3)} ${summary(afterRevoke)}`,
  );
  // 対照: 他ピアの検索は動いていて、結果は「未検証」に変わっただけ
  await setConfig(ORIGIN, "trust.search.acceptUnverified", "true");
  const afterRevokeOpen = await globalSearch(TRUST_QUERIES.revoke);
  await setConfig(ORIGIN, "trust.search.acceptUnverified", "false");
  check(
    "C8c",
    "失効後も開放モードなら beta.lab の結果は「未検証」として出る（C8b の対照）",
    afterRevokeOpen.some((h) => siteOf(h) === "beta.lab" && h.verified === "false"),
    summary(afterRevokeOpen),
  );
}

let failure: unknown = null;
try {
  await main();
} catch (e) {
  failure = e;
  log("ERROR", e);
}

const at = new Date().toISOString();
const md = [
  "# yacy-lab trust and NAT test",
  "",
  `- at: ${at}`,
  `- result: ${!failure && checks.every((c) => c.ok) ? "all passed" : "FAILED"} (${checks.filter((c) => c.ok).length}/${checks.length} checks passed${failure ? `, aborted: ${String(failure)}` : ""})`,
  "",
  "| id | check | result | detail |",
  "|---|---|---|---|",
  ...checks.map((c) => `| ${c.id} | ${c.title} | ${c.ok ? "PASS" : "**FAIL**"} | ${c.detail.replace(/\|/g, "\\|").slice(0, 300)} |`),
  "",
];
mkdirSync("results", { recursive: true });
writeFileSync(`results/trust-${at.replace(/[:.]/g, "-")}.md`, md.join("\n"));
writeFileSync("results/trust-latest.md", md.join("\n"));
console.log(md.join("\n"));
process.exit(!failure && checks.every((c) => c.ok) ? 0 : 1);
