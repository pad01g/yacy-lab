// 実験の一連の手順: ピア接続待ち → crawl → 索引待ち → 評価 → results/ へ保存。
//   docker compose run --rm runner                       # 両クラスタで全部
//   docker compose run --rm runner --skip-crawl          # 評価だけやり直す
//   docker compose run --rm runner --clusters fork       # 片方だけ
//
// シナリオ（問い合わせ元ノードの設定を切り替えて同じクエリを投げ直す）:
//   default:   通常の global 検索。upstream は新規ピアを DHT 検索先にしないので、他ピアへは Solr だけが飛ぶ。
//              フォークは remotesearch.dht.minage=0 で他ピアを DHT 検索先にし、その分 Solr の追加問い合わせ先から外れる
//   solr-only: RWI（自ピア・他ピアとも）を切り、フォークも DHT 検索の最低年齢を upstream と同じ 3 日に戻す。
//              両クラスタとも「自ピア Solr + 全ピアへの remote Solr」という同じ経路になり、
//              mm・被覆率・CJK bigram の Solr 側の違いだけが出る
//   rwi-only:  Solr を自ピア・他ピアとも切り、単語索引（RWI）とその remote 検索（DHT 検索）だけで引く。
//              CJK の分かち書きと DHT 検索先の選び方の違いがここに出る
// フォークだけで回す内訳（solr-only から 1 つずつ改善を設定で切る / 変える）:
//   solr-only:mm=1          Solr の minimum match を upstream と同じ 1 に戻す（被覆率の重みだけが残る）
//   solr-only:no-coverage   被覆率の重みを切る（mm だけが残る）
//   solr-only:mm=1+no-cov   両方切る。残る差は schema の CJK bigram と title の phrase boost だけ
//   solr-only:mm=100%       全語を必須にする（言い換えの正解を落とす代償を見る）
//
// 評価の指標（クエリごと。R = 正解頁数）:
//   R-prec:   上位 R 件のうち正解の割合。並びの良さ
//   recall:   上位 10 件に入った正解の割合。他ピアの頁を集められたか
//   decoy@R:  上位 R 件に入った罠頁（1 語だけの詰め込み頁）の割合
//   allTerms: 上位 10 件のうち、全語を title / snippet / url に含む割合（client/src/eval.ts と同じ定義）
//   remote:   上位 10 件のうち、問い合わせたノード以外が crawl したサイトの頁の割合。P2P で集めた分
import { mkdirSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { buildCorpus, judgements, SITES, type Judgement } from "./corpus.ts";
import { peers, search, setConfig, startCrawl, status, type Hit } from "./yacy.ts";

const { values } = parseArgs({
  options: {
    clusters: { type: "string", default: "upstream,fork" },
    "skip-crawl": { type: "boolean", default: false },
    wait: { type: "string", default: "6000" }, // global search の 1 回目から計測までの待ち時間
    label: { type: "string", default: "" },
    scenarios: { type: "string", default: "default,solr-only,rwi-only,solr-only:mm=1,solr-only:no-coverage,solr-only:mm=1+no-cov,solr-only:mm=100%" },
  },
});

// remotesearch.dht.minage はフォークだけが読む（upstream は 3 日で固定）
const DEFAULTS = {
  "debug.search.local.solr.off": "false",
  "debug.search.remote.solr.off": "false",
  "debug.search.local.dht.off": "false",
  "debug.search.remote.dht.off": "false",
  "remotesearch.dht.minage": "0", // yacy/yacy.conf と同じ値
};
const SOLR_ONLY = { ...DEFAULTS, "debug.search.local.dht.off": "true", "debug.search.remote.dht.off": "true", "remotesearch.dht.minage": "3" };
const MM_1 = { "search.ranking.solr.mm": "1", "search.ranking.solr.mm.cjk": "1" };
const NO_COVERAGE = { "search.ranking.coverage.exponent": "0" };
// フォークの設定の既定値（yacy.init と同じ）。内訳シナリオの後に戻す
const FORK_DEFAULTS = { "search.ranking.solr.mm": "2<-1 5<80%", "search.ranking.solr.mm.cjk": "2<-1 5<80%", "search.ranking.coverage.exponent": "2" };
type Scenario = { config: Record<string, string>; forkOnly?: boolean };
const SCENARIOS: Record<string, Scenario> = {
  default: { config: DEFAULTS },
  "solr-only": { config: SOLR_ONLY },
  "rwi-only": { config: { ...DEFAULTS, "debug.search.local.solr.off": "true", "debug.search.remote.solr.off": "true" } },
  "solr-only:mm=1": { config: { ...SOLR_ONLY, ...MM_1 }, forkOnly: true },
  "solr-only:no-coverage": { config: { ...SOLR_ONLY, ...NO_COVERAGE }, forkOnly: true },
  "solr-only:mm=1+no-cov": { config: { ...SOLR_ONLY, ...MM_1, ...NO_COVERAGE }, forkOnly: true },
  "solr-only:mm=100%": { config: { ...SOLR_ONLY, "search.ranking.solr.mm": "100%", "search.ranking.solr.mm.cjk": "100%" }, forkOnly: true },
};
const scenarios = values.scenarios.split(",").filter((s) => s in SCENARIOS);

const NODES: Record<string, string[]> = {
  upstream: ["up-1", "up-2", "up-3"],
  fork: ["fork-1", "fork-2", "fork-3"],
};
const clusters = values.clusters.split(",").filter((c) => c in NODES);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]): void => console.error(new Date().toISOString().slice(11, 19), ...a);

async function until<T>(what: string, timeoutMs: number, probe: () => Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe().catch(() => undefined);
    if (v !== undefined) return v;
    if (Date.now() > deadline) throw new Error(`timeout: ${what}`);
    await sleep(3000);
  }
}

async function waitForNetwork(nodes: string[]): Promise<void> {
  for (const node of nodes) await until(`${node} up`, 300_000, async () => ((await status(node)) ? true : undefined));
  // 各ノードが他の全ノードを senior 以上として知っていること
  await until(`${nodes[0]} peers`, 600_000, async () => {
    const counts = await Promise.all(nodes.map(async (n) => (await peers(n)).filter((p) => p.type === "senior" || p.type === "principal").length));
    log("senior peers seen:", nodes.map((n, i) => `${n}=${counts[i]}`).join(" "));
    return counts.every((c) => c >= nodes.length - 1) ? true : undefined;
  });
}

async function crawlAll(nodes: string[]): Promise<void> {
  const pages = buildCorpus();
  await Promise.all(
    nodes.map(async (node, i) => {
      const site = SITES[i];
      const expected = pages.filter((p) => p.site === site).length + 1; // + 目次頁
      log(node, await startCrawl(node, `http://${site}/`));
      await until(`${node} index ${site}`, 900_000, async () => {
        const s = await status(node);
        return s.docs >= expected && s.loader === 0 && s.localCrawler === 0 ? s : undefined;
      });
      log(node, `indexed ${site}`, await status(node));
    }),
  );
}

const termsOf = (q: string): string[] => q.toLowerCase().split(/\s+/).filter(Boolean);
const decode = (u: string): string => {
  try {
    return decodeURIComponent(u);
  } catch {
    return u;
  }
};
const haystack = (h: Hit): string => `${h.title} ${h.snippet} ${decode(h.url)}`.toLowerCase();

type Row = {
  id: string;
  lang: string;
  query: string;
  total: number;
  rprec: number;
  recall: number;
  decoy: number;
  allTerms: number;
  remote: number;
  top: { url: string; title: string; judge: "relevant" | "decoy" | "other" }[];
};

async function evaluate(origin: string, js: Judgement[], scenario: string): Promise<Row[]> {
  const rows: Row[] = [];
  const originSite = SITES[0];
  for (const [key, value] of Object.entries(SCENARIOS[scenario].config)) await setConfig(origin, key, value);
  try {
    for (const j of js) {
      await search(origin, j.query, "global", 10, scenario).catch(() => undefined); // 1 回目で他ピアへ問い合わせを起こす
      await sleep(Number(values.wait));
      // YaCy fixes the order of results when they are first taken; re-sort for the measured answer, so that the
      // ranking and not the arrival time decides
      const { total, hits } = await search(origin, j.query, "global", 10, scenario, true);
      const top = hits.slice(0, 10);
      const R = j.relevant.length;
      const rel = new Set(j.relevant);
      const dec = new Set(j.decoys);
      const terms = termsOf(j.query);
      const judge = (h: Hit): Row["top"][number]["judge"] => (rel.has(h.url) ? "relevant" : dec.has(h.url) ? "decoy" : "other");
      const n = top.length;
      const r: Row = {
        id: j.id,
        lang: j.lang,
        query: j.query,
        total,
        rprec: top.slice(0, R).filter((h) => rel.has(h.url)).length / R,
        recall: top.filter((h) => rel.has(h.url)).length / R,
        decoy: top.slice(0, R).filter((h) => dec.has(h.url)).length / R,
        allTerms: n ? top.filter((h) => terms.every((t) => haystack(h).includes(t))).length / n : 0,
        remote: n ? top.filter((h) => !h.url.startsWith(`http://${originSite}/`)).length / n : 0,
        top: top.map((h) => ({ url: h.url, title: h.title, judge: judge(h) })),
      };
      rows.push(r);
      log(origin, scenario, j.query, `R-prec=${r.rprec.toFixed(2)} recall=${r.recall.toFixed(2)} decoy=${r.decoy.toFixed(2)} remote=${r.remote.toFixed(2)}`);
    }
  } finally {
    for (const [key, value] of Object.entries({ ...DEFAULTS, ...FORK_DEFAULTS })) await setConfig(origin, key, value);
  }
  return rows;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
type Summary = { rprec: number; recall: number; decoy: number; allTerms: number; remote: number };
const summarize = (rows: Row[]): Summary => ({
  rprec: mean(rows.map((r) => r.rprec)),
  recall: mean(rows.map((r) => r.recall)),
  decoy: mean(rows.map((r) => r.decoy)),
  allTerms: mean(rows.map((r) => r.allTerms)),
  remote: mean(rows.map((r) => r.remote)),
});
type Result = { cluster: string; scenario: string; rows: Row[]; all: Summary; en: Summary; cjk: Summary };

const js = judgements();
await Promise.all(
  clusters.map(async (c) => {
    const nodes = NODES[c];
    log(`[${c}] waiting for P2P network`);
    await waitForNetwork(nodes);
    if (!values["skip-crawl"]) {
      log(`[${c}] crawling`);
      await crawlAll(nodes);
    }
  }),
);
// 評価はクラスタごとに順番に行う（同時に走らせると CPU を取り合い、remote の応答時間が変わるため）
const results: Result[] = [];
for (const scenario of scenarios) {
  for (const cluster of clusters) {
    if (SCENARIOS[scenario].forkOnly && cluster !== "fork") continue;
    log(`[${cluster}] evaluating ${scenario}`);
    const rows = await evaluate(NODES[cluster][0], js, scenario);
    results.push({ cluster, scenario, rows, all: summarize(rows), en: summarize(rows.filter((r) => r.lang === "en")), cjk: summarize(rows.filter((r) => r.lang !== "en")) });
  }
}

const at = new Date().toISOString();
const f = (x: number): string => x.toFixed(2);
const name = (r: Result): string => `${r.cluster} / ${r.scenario}`;
const md: string[] = [];
md.push(`# yacy-lab results ${values.label}`.trim(), "", `- at: ${at}`, `- clusters: ${clusters.join(", ")}; scenarios: ${scenarios.join(", ")}`, `- query origin: node 1 of each cluster (crawled ${SITES[0]} only), resource=global`, "");
md.push("## Summary", "", "| cluster / scenario | subset | R-prec ↑ | recall@10 ↑ | decoy@R ↓ | allTerms@10 ↑ | remote@10 |", "|---|---|---:|---:|---:|---:|---:|");
for (const r of results) {
  for (const k of ["all", "en", "cjk"] as const) {
    const s = r[k];
    md.push(`| ${name(r)} | ${k} | ${f(s.rprec)} | ${f(s.recall)} | ${f(s.decoy)} | ${f(s.allTerms)} | ${f(s.remote)} |`);
  }
}
const summaryLines = md.length;
md.push("", "## Per query (R-prec / decoy@R)", "", `| query | ${results.map(name).join(" | ")} |`, `|---|${results.map(() => "---:").join("|")}|`);
for (const [i, j] of js.entries()) {
  md.push(`| ${j.query} | ${results.map((r) => `${f(r.rows[i].rprec)} / ${f(r.rows[i].decoy)}`).join(" | ")} |`);
}
md.push("", "## Top 10 per query", "", "`R` = relevant, `d` = decoy (keyword-stuffed page with one query term), `-` = other", "");
for (const [i, j] of js.entries()) {
  md.push(`### ${j.query}`, "");
  for (const r of results) {
    md.push(`- ${name(r)}: ${r.rows[i].top.map((t) => (t.judge === "relevant" ? "R" : t.judge === "decoy" ? "d" : "-")).join(" ") || "(no results)"}`);
  }
  md.push("");
}

mkdirSync("results", { recursive: true });
const stamp = at.replace(/[:.]/g, "-");
const file = values.label ? `${stamp}-${values.label}` : stamp;
writeFileSync(`results/${file}.json`, JSON.stringify({ at, clusters, scenarios, results }, null, 2));
writeFileSync(`results/${file}.md`, md.join("\n") + "\n");
writeFileSync("results/latest.md", md.join("\n") + "\n");
console.log(md.slice(0, summaryLines).join("\n"));
log(`wrote results/${file}.md`);
