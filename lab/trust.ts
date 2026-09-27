// 身元・信頼・NAT 越えの試験（compose.trust.yaml）。docs/trust-and-nat.md の §10 の確認項目を順に実行する。
//   docker compose -f compose.trust.yaml -p yacytrust run --rm runner [--skip-crawl]
// 各項目を PASS / FAIL で記録し、results/trust-<時刻>.md に保存する。1 つでも FAIL なら終了コード 1。
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { TRUST_QUERIES } from "./corpus.ts";
import { ALL, delegation, LAB, log, ORIGIN, peerList, PUBLIC, putFile, setupTrustNetwork, sleep, trustBundle, until } from "./trustlib.ts";
import { base, fetchAdmin, mySeed, peers, search, setConfig, status, type Hit } from "./yacy.ts";

const { values } = parseArgs({ options: { "skip-crawl": { type: "boolean", default: false } } });

// ---- 結果の記録
type Check = { id: string; title: string; ok: boolean; detail: string };
const checks: Check[] = [];
function check(id: string, title: string, ok: boolean, detail: string): void {
  checks.push({ id, title, ok, detail });
  log(ok ? "PASS" : "FAIL", id, title, "-", detail);
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
  // 1〜4. ノードの起動待ち、信頼の一覧の配布、網の接続待ち、crawl（trustlib.ts）
  const { seeds, pk, coordinator, operator, members, natSeen } = await setupTrustNetwork({ skipCrawl: values["skip-crawl"] });

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
  // fork-1 から nat-1 への peer ping（トンネル経由の hello）も通り、nat-1 が接続中のまま保たれる。
  // 通らないと fork-1 は 1 分ごとに nat-1 を切断扱いにし、その間の検索で delta.lab が出なくなる
  const samples: string[] = [];
  for (let i = 0; i < 16; i++) {
    const p = (await peers(ORIGIN)).find((x) => x.hash === seeds["nat-1"].Hash);
    samples.push(p ? p.type : "absent");
    await sleep(10_000);
  }
  const natAgain = await globalSearch(TRUST_QUERIES.nat);
  check(
    "C6f",
    "fork-1 は nat-1 を 150 秒間ずっと接続中の senior として保ち、その後の検索でも delta.lab が見つかる",
    samples.every((t) => t === "senior" || t === "principal") && natAgain.some((h) => siteOf(h) === "delta.lab"),
    `${samples.join(",")} / ${summary(natAgain)}`,
  );
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
