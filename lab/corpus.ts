// 決定的に生成する評価用コーパス。lab サーバーが HTML として配り、eval が正解集合として読む。
//
// 各トピックには 3 種類の頁がある:
//   relevant:   クエリの全語を本文に含む（正解）
//   paraphrase: 内容は正解だがクエリ語の一部を別の形で書いている（正解に数える。3 トピックのみ）
//   decoy:      クエリの 1 語だけを title と本文に大量に含む（キーワード詰め込みの罠）
// 正解は主に beta / gamma に置き、罠は gamma に寄せる。検索は alpha を crawl したノードから global で出すので、
//   - 他ピアの結果を集めないと正解が揃わない
//   - gamma のピアは 1 位が罠になり、ピア単位の正規化でその罠が 1.0 に持ち上がる
// という upstream の弱点がそのまま効く配置にしている。
// URL はサイトごとの連番（/doc/000.html）で、トピック名などクエリ語になりうる文字列を含めない。

export const SITES = ["alpha.lab", "beta.lab", "gamma.lab"] as const;
export type Site = (typeof SITES)[number];

export type Lang = "en" | "ja" | "zh";

type Topic = {
  id: string;
  lang: Lang;
  query: string;
  // 正解頁の title 候補と、全語を含む文の候補
  titles: string[];
  sentences: string[];
  // 罠: 1 語だけを含む title と文
  decoys: { term: string; titles: string[]; sentences: string[] }[];
  // 言い換えの正解: 内容は正解だがクエリ語の一部を含まない（活用形・表記ゆれ・別の語）。
  // 全語一致を求めるほど取りこぼす頁で、厳しい minimum match の代償を測るために置く
  paraphrases?: { title: string; sentences: string[] }[];
};

export const TOPICS: Topic[] = [
  {
    id: "erc4337",
    lang: "en",
    query: "ERC-4337 bundler",
    titles: ["How an ERC-4337 bundler packs UserOperations", "Running your own ERC-4337 bundler", "ERC-4337 bundler mempool rules", "Account abstraction: the ERC-4337 bundler role", "Choosing an ERC-4337 bundler provider"],
    sentences: [
      "An ERC-4337 bundler collects UserOperations from the alt mempool and submits them to the EntryPoint contract.",
      "The bundler simulates each ERC-4337 UserOperation before it pays gas for the bundle.",
      "Because the ERC-4337 bundler fronts the gas, it rejects operations whose paymaster cannot reimburse it.",
    ],
    decoys: [
      {
        term: "bundler",
        titles: ["Bundler::Fetcher - Ruby Bundler documentation", "Bundler::Injector - Ruby Bundler", "Bundler Gemfile reference", "Bundler install troubleshooting", "Bundler lockfile format"],
        sentences: ["Bundler resolves gem versions from the Gemfile.", "Run bundler install to fetch gems with Bundler.", "Bundler writes Gemfile.lock so that bundler exec uses the same gems."],
      },
      {
        term: "erc-4337",
        titles: ["ERC-4337 news roundup", "ERC-4337 adoption statistics"],
        sentences: ["ERC-4337 was discussed at the conference.", "Many wallets announced ERC-4337 support this year."],
      },
    ],
  },
  {
    id: "tokio",
    lang: "en",
    query: "tokio select cancellation safety",
    titles: ["Cancellation safety in tokio::select!", "Why tokio select needs cancellation safety", "Tokio select loops and cancellation safety", "Writing cancellation safe futures for tokio select"],
    sentences: [
      "When a tokio select branch loses the race, its future is dropped, so cancellation safety decides whether data is lost.",
      "The tokio documentation lists which methods have cancellation safety inside select.",
      "A read_exact call is not cancellation safe, so do not put it directly into tokio select.",
    ],
    decoys: [
      {
        term: "tokio",
        titles: ["Tokio runtime configuration", "Tokio tutorial: spawning tasks", "Tokio vs async-std benchmarks", "Tokio console overview"],
        sentences: ["Tokio is an asynchronous runtime for Rust.", "The Tokio runtime schedules tasks on worker threads.", "Tokio provides timers, TCP and UDP sockets."],
      },
      {
        term: "safety",
        titles: ["Workplace safety checklist", "Food safety basics", "Safety data sheet guide"],
        sentences: ["Safety first: wear protective equipment.", "Our safety team reviews every incident.", "Safety training is mandatory for new staff."],
      },
    ],
  },
  {
    id: "autovacuum",
    lang: "en",
    query: "postgres autovacuum tuning",
    titles: ["Postgres autovacuum tuning for large tables", "A practical guide to autovacuum tuning in Postgres", "Postgres autovacuum tuning: scale factor and cost limit", "Autovacuum tuning checklist for Postgres 16"],
    sentences: [
      "Postgres autovacuum tuning usually starts with lowering autovacuum_vacuum_scale_factor on big tables.",
      "For write heavy Postgres clusters, autovacuum tuning means raising autovacuum_vacuum_cost_limit.",
      "Monitor dead tuples before and after autovacuum tuning so you can see whether Postgres keeps up.",
    ],
    decoys: [
      {
        term: "postgres",
        titles: ["Postgres installation on Ubuntu", "Postgres roles and privileges", "Postgres JSONB operators", "Postgres backup with pg_dump"],
        sentences: ["Postgres is an open source relational database.", "Create a Postgres role with LOGIN.", "Postgres supports JSONB columns and indexes."],
      },
      {
        term: "tuning",
        titles: ["Guitar tuning for beginners", "Piano tuning prices", "Car engine tuning shops"],
        sentences: ["Standard guitar tuning is E A D G B E.", "Tuning a piano takes about an hour.", "Engine tuning can improve fuel economy."],
      },
    ],
    paraphrases: [
      {
        title: "Tuning autovacuum in PostgreSQL",
        sentences: ["In PostgreSQL, tuning autovacuum starts with the scale factor of large tables.", "Raise the cost limit so that autovacuum keeps up with PostgreSQL write load."],
      },
    ],
  },
  {
    id: "eviction",
    lang: "en",
    query: "kubernetes pod eviction",
    titles: ["Kubernetes pod eviction under node pressure", "Understanding Kubernetes pod eviction", "Kubernetes pod eviction and PodDisruptionBudget", "Debugging Kubernetes pod eviction"],
    sentences: [
      "The kubelet starts Kubernetes pod eviction when memory.available drops below the eviction threshold.",
      "Kubernetes pod eviction through the Eviction API respects a PodDisruptionBudget.",
      "BestEffort pods are the first candidates for Kubernetes pod eviction on a node.",
    ],
    decoys: [
      {
        term: "kubernetes",
        titles: ["Kubernetes the hard way", "Kubernetes release notes", "Kubernetes certification tips", "Kubernetes dashboard setup"],
        sentences: ["Kubernetes orchestrates containers.", "Install Kubernetes with kubeadm.", "Kubernetes clusters have a control plane and worker nodes."],
      },
      {
        term: "eviction",
        titles: ["Tenant eviction notice template", "Eviction law for landlords", "How to fight an eviction"],
        sentences: ["An eviction notice must be delivered in writing.", "The court schedules an eviction hearing.", "Eviction rules differ by state."],
      },
    ],
    paraphrases: [
      {
        title: "Why the kubelet evicts pods",
        sentences: ["The Kubernetes kubelet evicts a pod when the node runs out of memory.", "Pods without resource requests are evicted first on a Kubernetes node."],
      },
    ],
  },
  {
    id: "lightning",
    lang: "en",
    query: "bitcoin lightning channel",
    titles: ["Opening a bitcoin lightning channel", "Bitcoin lightning channel capacity explained", "Closing a bitcoin lightning channel safely", "Bitcoin lightning channel liquidity"],
    sentences: [
      "A bitcoin lightning channel is funded by an on-chain transaction between two nodes.",
      "The capacity of a bitcoin lightning channel is fixed when the funding transaction confirms.",
      "Rebalancing moves liquidity from one bitcoin lightning channel to another.",
    ],
    decoys: [
      {
        term: "bitcoin",
        titles: ["Bitcoin price today", "Bitcoin halving history", "Bitcoin ETF news", "Bitcoin mining difficulty"],
        sentences: ["Bitcoin rose five percent today.", "The bitcoin halving cuts the block reward.", "Bitcoin mining uses proof of work."],
      },
      {
        term: "lightning",
        titles: ["Lightning safety during storms", "Lightning strike statistics", "Lightning photography tips"],
        sentences: ["Lightning can strike the same place twice.", "Stay indoors when lightning is near.", "Lightning heats the air to thirty thousand degrees."],
      },
    ],
  },
  {
    id: "edismax",
    lang: "en",
    query: "solr edismax minimum match",
    titles: ["Solr edismax minimum match (mm) explained", "Tuning minimum match in Solr edismax", "Solr edismax: minimum match expressions", "Why Solr edismax minimum match returns too many results"],
    sentences: [
      "The Solr edismax parser uses the minimum match parameter mm to decide how many clauses must match.",
      "Setting minimum match to 100% in Solr edismax requires every query term.",
      "A Solr edismax minimum match of 1 turns a multi word query into an OR query.",
    ],
    decoys: [
      {
        term: "solr",
        titles: ["Solr installation guide", "Solr cloud collections", "Solr schema design", "Solr admin UI"],
        sentences: ["Solr is a search server built on Lucene.", "Start Solr with bin/solr start.", "Solr stores documents in cores."],
      },
      {
        term: "match",
        titles: ["Match report: city derby", "Match highlights", "Tennis match schedule"],
        sentences: ["The match ended in a draw.", "Tickets for the match sold out.", "The final match starts at eight."],
      },
    ],
  },
  {
    id: "vasp",
    lang: "ja",
    query: "暗号資産交換業 登録 金融庁",
    titles: ["暗号資産交換業者の登録制度について", "暗号資産交換業の登録申請の流れ", "金融庁による暗号資産交換業者の登録一覧", "暗号資産交換業者登録と金融庁の監督"],
    sentences: [
      "暗号資産交換業を営むには、金融庁への登録が必要です。",
      "金融庁は暗号資産交換業者の登録審査で、利用者財産の分別管理を確認します。",
      "無登録で暗号資産交換業を行うと、金融庁から警告を受けます。",
    ],
    decoys: [
      {
        term: "登録",
        titles: ["会員登録のご案内", "メールアドレス登録方法", "無料会員登録キャンペーン", "ポイントカード登録", "住所変更と再登録"],
        sentences: ["会員登録は無料です。", "登録したメールアドレスに確認メールが届きます。", "登録完了後、ログインしてください。"],
      },
      {
        term: "金融庁",
        titles: ["金融庁の人事異動", "金融庁の組織図"],
        sentences: ["金融庁は本日、人事異動を発表しました。", "金融庁の庁舎は霞が関にあります。"],
      },
    ],
    paraphrases: [
      {
        title: "暗号資産交換業者の登録審査の実務",
        sentences: ["暗号資産交換業者の登録審査は、財務局が申請書類を確認して進めます。", "登録前の暗号資産交換業者は、利用者保護の体制を整える必要があります。"],
      },
    ],
  },
  {
    id: "stablecoin",
    lang: "ja",
    query: "ステーブルコイン 規制",
    titles: ["ステーブルコイン規制の最新動向", "日本のステーブルコイン規制", "ステーブルコインに対する規制の論点", "ステーブルコインの発行と規制"],
    sentences: [
      "改正資金決済法により、ステーブルコインの発行者は規制の対象になりました。",
      "ステーブルコインの規制では、裏付け資産の保全が重視されます。",
      "海外発行のステーブルコインを扱う仲介業者にも規制がかかります。",
    ],
    decoys: [
      {
        term: "規制",
        titles: ["交通規制のお知らせ", "花火大会の交通規制", "道路工事による規制情報", "マラソン大会の規制区間"],
        sentences: ["当日は周辺道路で交通規制を行います。", "規制時間は午前九時から午後三時までです。", "規制区間では迂回してください。"],
      },
    ],
  },
  {
    id: "expo",
    lang: "ja",
    query: "大阪 万博",
    titles: ["大阪万博の見どころ", "大阪・関西万博のパビリオン案内", "大阪万博への行き方", "大阪万博の入場チケット"],
    sentences: [
      "大阪・関西万博は夢洲で開催されました。",
      "大阪万博の会場には多くの国のパビリオンが並びました。",
      "大阪駅から万博会場まではシャトルバスが出ています。",
    ],
    decoys: [
      {
        term: "大阪",
        titles: ["大阪のたこ焼き名店", "大阪城の歴史", "大阪の天気予報", "大阪の夜景スポット"],
        sentences: ["大阪はたこ焼きが有名です。", "大阪城は豊臣秀吉が築きました。", "大阪の夜景は美しいです。"],
      },
    ],
  },
  {
    id: "ml",
    lang: "ja",
    query: "機械学習 入門",
    titles: ["機械学習入門：最初の一歩", "はじめての機械学習入門講座", "機械学習の入門書まとめ", "Pythonで学ぶ機械学習入門"],
    sentences: [
      "この機械学習入門では、線形回帰から始めます。",
      "機械学習の入門として、分類と回帰の違いを説明します。",
      "入門者向けに、機械学習の評価指標を紹介します。",
    ],
    decoys: [
      {
        term: "入門",
        titles: ["茶道入門", "将棋入門", "ギター入門", "囲碁入門"],
        sentences: ["入門編では基本の作法を学びます。", "入門者歓迎の教室です。", "入門講座は毎週土曜日です。"],
      },
    ],
  },
  {
    id: "wallet",
    lang: "zh",
    query: "区块链 钱包",
    titles: ["区块链钱包的工作原理", "如何选择区块链钱包", "区块链钱包安全指南", "区块链钱包与私钥"],
    sentences: [
      "区块链钱包保存的是私钥，而不是代币本身。",
      "使用区块链钱包时，请备份助记词。",
      "硬件钱包是更安全的区块链钱包。",
    ],
    decoys: [
      {
        term: "钱包",
        titles: ["真皮钱包推荐", "男士钱包品牌", "钱包丢失怎么办", "女士长款钱包"],
        sentences: ["这款钱包采用真皮制作。", "钱包里有很多卡位。", "钱包丢了请尽快挂失银行卡。"],
      },
    ],
  },
];

// 文書数の比率を整えるための無関係な頁
const FILLER_EN = [
  "The weather was mild and the meeting ended early.",
  "Our team published the quarterly report on Monday.",
  "Please read the contribution guide before opening a pull request.",
  "The library closes at nine in the evening.",
  "Shipping usually takes three to five business days.",
  "This page describes the history of the project.",
  "Volunteers maintain the documentation in their spare time.",
  "The recipe needs flour, sugar and two eggs.",
];
const FILLER_JA = [
  "本日は晴れのち曇りでした。",
  "新しい店舗が駅前にオープンしました。",
  "次回の説明会は来月に開催します。",
  "図書館の開館時間が変わりました。",
  "お問い合わせはフォームからお願いします。",
  "今週末は地域の清掃活動があります。",
];
const FILLER_ZH = ["今天天气很好。", "新的商店在车站前开业了。", "请通过表格联系我们。", "周末有社区活动。"];

// 決定的な擬似乱数（mulberry32）
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Page = {
  site: Site;
  path: string;
  title: string;
  body: string[];
  lang: Lang;
  topic?: string;
  kind: "relevant" | "decoy" | "filler";
};

const escape = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function renderPage(p: Page): string {
  const htmlLang = p.lang === "zh" ? "zh-CN" : p.lang;
  return `<!doctype html>
<html lang="${htmlLang}"><head><meta charset="utf-8"><title>${escape(p.title)}</title></head>
<body><h1>${escape(p.title)}</h1>
${p.body.map((s) => `<p>${escape(s)}</p>`).join("\n")}
<p><a href="/">index</a></p>
</body></html>
`;
}

// 正解は beta / gamma 中心で alpha にも 1 件、罠は gamma 中心
const RELEVANT_SITES: Site[] = ["beta.lab", "gamma.lab", "beta.lab", "gamma.lab", "alpha.lab"];
const DECOY_SITES: Site[] = ["gamma.lab", "gamma.lab", "alpha.lab", "gamma.lab", "beta.lab"];

export function buildCorpus(): Page[] {
  const pages: Page[] = [];
  const r = rng(4337);
  const pick = <T>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const filler = (lang: Lang, n: number): string[] =>
    Array.from({ length: n }, () => pick(lang === "en" ? FILLER_EN : lang === "ja" ? FILLER_JA : FILLER_ZH));

  for (const t of TOPICS) {
    t.titles.forEach((title, i) => {
      const s = t.sentences;
      pages.push({
        site: RELEVANT_SITES[i % RELEVANT_SITES.length],
        path: `/${t.id}/r${i}.html`,
        title,
        body: [s[i % s.length], ...filler(t.lang, 3), s[(i + 1) % s.length], ...filler(t.lang, 2), s[(i + 2) % s.length]],
        lang: t.lang,
        topic: t.id,
        kind: "relevant",
      });
    });
    (t.paraphrases ?? []).forEach((p, i) => {
      pages.push({
        site: "beta.lab",
        path: `/${t.id}/p${i}.html`,
        title: p.title,
        body: [p.sentences[0], ...filler(t.lang, 3), p.sentences[1], ...filler(t.lang, 2)],
        lang: t.lang,
        topic: t.id,
        kind: "relevant",
      });
    });
    let d = 0;
    for (const decoy of t.decoys) {
      decoy.titles.forEach((title, i) => {
        // 1 語を何度も繰り返す（キーワード詰め込み）
        const stuffed = Array.from({ length: 8 }, (_, k) => decoy.sentences[(i + k) % decoy.sentences.length]);
        pages.push({
          site: DECOY_SITES[d % DECOY_SITES.length],
          path: `/${t.id}/d${d}.html`,
          title,
          body: [...stuffed, ...filler(t.lang, 2)],
          lang: t.lang,
          topic: t.id,
          kind: "decoy",
        });
        d++;
      });
    }
  }
  // 各サイトに無関係な頁を足して DF を現実寄りにする
  for (const site of SITES) {
    for (let i = 0; i < 12; i++) {
      const lang: Lang = i % 3 === 0 ? "ja" : i % 3 === 1 ? "en" : "zh";
      pages.push({ site, path: `/misc/f${i}.html`, title: `${site} misc ${i}`, body: filler(lang, 6), lang, kind: "filler" });
    }
  }
  // URL にトピック名（autovacuum, eviction など）が入るとクエリ語が URL で一致してしまうので、サイトごとの連番に置き換える。
  // 並びは r() で混ぜ、番号から種別が分からないようにする
  const counters = new Map<Site, number>();
  const order = pages.map((p, i) => ({ p, k: r(), i })).sort((a, b) => a.k - b.k || a.i - b.i);
  for (const { p } of order) {
    const n = counters.get(p.site) ?? 0;
    counters.set(p.site, n + 1);
    p.path = `/doc/${String(n).padStart(3, "0")}.html`;
  }
  return pages;
}

export const urlOf = (p: Page): string => `http://${p.site}${p.path}`;

export type Judgement = { id: string; lang: Lang; query: string; relevant: string[]; decoys: string[] };

export function judgements(pages: Page[] = buildCorpus()): Judgement[] {
  return TOPICS.map((t) => ({
    id: t.id,
    lang: t.lang,
    query: t.query,
    relevant: pages.filter((p) => p.topic === t.id && p.kind === "relevant").map(urlOf),
    decoys: pages.filter((p) => p.topic === t.id && p.kind === "decoy").map(urlOf),
  }));
}

// ---- 信頼と NAT の試験用コーパス（compose.trust.yaml）
//   spam.lab:  信頼集合外のピア（evil-1）が crawl する。クエリの全語を含むマルウェア誘導頁（mm も被覆率も通り抜ける）
//   ads.lab:   信頼集合にいるが ads を宣言したピア（ads-1）が crawl する広告頁
//   delta.lab: NAT の内側のピア（nat-1）だけが crawl する頁。リレー経由でしか見つからない

export const TRUST_SITES = ["spam.lab", "ads.lab", "delta.lab"] as const;

export type TrustPage = { site: (typeof TRUST_SITES)[number]; path: string; title: string; body: string[] };

export const TRUST_QUERIES = {
  spam: "bitcoin lightning channel",
  ads: "kubernetes pod eviction",
  nat: "circuit relay hole punching",
} as const;

export function buildTrustCorpus(): TrustPage[] {
  const pages: TrustPage[] = [];
  for (let i = 0; i < 5; i++) {
    pages.push({
      site: "spam.lab",
      path: `/doc/${String(i).padStart(3, "0")}.html`,
      title: `Bitcoin lightning channel free wallet download ${i}`,
      body: [
        "Open a bitcoin lightning channel instantly with our free wallet.",
        "Download the bitcoin lightning channel booster now: http://malware.example/setup.exe",
        "Every bitcoin lightning channel user needs this tool.",
      ],
    });
    pages.push({
      site: "spam.lab",
      path: `/doc/${String(i + 5).padStart(3, "0")}.html`,
      title: `Kubernetes pod eviction fix tool ${i}`,
      body: ["Stop kubernetes pod eviction forever: install our agent from http://malware.example/agent.sh", "kubernetes pod eviction solved."],
    });
  }
  for (let i = 0; i < 4; i++) {
    pages.push({
      site: "ads.lab",
      path: `/doc/${String(i).padStart(3, "0")}.html`,
      title: `Sponsored: kubernetes pod eviction monitoring ${i}`,
      body: ["Sponsored result. Watch kubernetes pod eviction with our paid dashboard.", "Kubernetes pod eviction alerts for teams."],
    });
  }
  const delta = [
    "A circuit relay lets two peers behind NAT talk; hole punching then upgrades the relayed connection.",
    "With circuit relay v2 a peer reserves a slot on the relay before hole punching starts.",
    "DCUtR coordinates hole punching over the circuit relay connection.",
    "If hole punching fails, the circuit relay keeps carrying the traffic.",
  ];
  delta.forEach((s, i) =>
    pages.push({ site: "delta.lab", path: `/doc/${String(i).padStart(3, "0")}.html`, title: `Circuit relay and hole punching, part ${i + 1}`, body: [s, delta[(i + 1) % delta.length]] }),
  );
  return pages;
}

export function renderTrustPage(p: TrustPage): string {
  return renderPage({ site: "alpha.lab", path: p.path, title: p.title, body: p.body, lang: "en", kind: "filler" });
}

export const trustUrlOf = (p: TrustPage): string => `http://${p.site}${p.path}`;
