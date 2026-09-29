# yacy-lab

**Reproducible experiments for peer-to-peer web search quality (YaCy upstream vs the improved-search fork), a browser demo, and an agent skill for running your own search engine.** Agents: install the skill with `npx skills add pad01g/yacy-lab` ([skills/yacy-p2p-search](skills/yacy-p2p-search/SKILL.md)); overview for machines: https://pad01g.github.io/yacy_search_server/llms.txt.

**Join the network without asking anyone** — [how to join](https://pad01g.github.io/yacy_search_server/join.html)
([日本語](https://pad01g.github.io/yacy_search_server/ja/join.html) · [简体中文](https://pad01g.github.io/yacy_search_server/zh/join.html) · [Español](https://pad01g.github.io/yacy_search_server/es/join.html) · [Português](https://pad01g.github.io/yacy_search_server/pt/join.html) · [한국어](https://pad01g.github.io/yacy_search_server/ko/join.html) · [Deutsch](https://pad01g.github.io/yacy_search_server/de/join.html) · [Français](https://pad01g.github.io/yacy_search_server/fr/join.html)).
**Pull requests are welcome**: new experiments, corpora and queries in more languages, fixes to the demo.
（網への参加は誰の許可も要らない。PR 歓迎: 実験、コーパス、他の言語のクエリ、デモの修正）

YaCy のフォーク [pad01g/yacy_search_server](https://github.com/pad01g/yacy_search_server)（branch `improved-search`）の改善が
P2P 網で効いているかを、docker compose だけで再現して確かめる実験と、手で触るためのデモ（プロジェクトの説明: https://pad01g.github.io/yacy_search_server/ja/ ）:

| 実験 | compose | 何を確かめるか |
|---|---|---|
| **検索品質** | `compose.yaml`（`-p yacylab`） | upstream 3 ノードとフォーク 3 ノードの閉じた網で、同じクエリの上位 10 件を採点して比べる |
| **信頼と NAT 越え** | `compose.trust.yaml`（`-p yacytrust`） | フォーク 6 ピア + リレー + NAT で、seed の署名・信頼の一覧・宣言タグ・偽の作者・NAT 越え・一覧の更新と失効を合否で確かめる |
| **デモ** | `compose.demo.yaml`（`-p yacydemo`） | 上の 2 つを合わせた網を立て、http://localhost:8800 の画面から両方の網に検索を投げて見比べる |

どれもインターネット上の YaCy 網には接続しない（閉じた網。ただし NAT 実験のルーターは起動時に `apk add` するため外向きの通信が要る）。

## 準備

必要なもの: Docker（メモリ 8GB 程度。YaCy 1 ノードあたり上限 1.1GB）。

yacy-lab の隣（中ではなく）にフォークを clone してビルドする（yacy-lab には `yacy/` という設定のディレクトリがある）:

```sh
# yacy-lab を clone した場所の親ディレクトリで
git clone https://github.com/pad01g/yacy_search_server.git yacy_search_server && cd yacy_search_server
git checkout baseline        && docker build -t yacy-lab/upstream:baseline -f docker/Dockerfile .   # upstream b50b76b + ビルド修正のみ
git checkout improved-search && docker build -t yacy-lab/fork:latest    -f docker/Dockerfile .
docker build -t yacy-lab/sidecar:latest sidecar/                                                     # NAT 越えの sidecar（信頼の実験だけ）
cd ../yacy-lab
```

ビルドせずに GHCR のイメージ（`ghcr.io/pad01g/yacy-improved-search`, `ghcr.io/pad01g/yacy-sidecar`）を使うなら、
`FORK_IMAGE=ghcr.io/pad01g/yacy-improved-search:latest SIDECAR_IMAGE=ghcr.io/pad01g/yacy-sidecar:latest` を付けて compose を動かす。

`baseline` タグは upstream `b50b76b` に `.dockerignore` の修正（`docker build` が `test/jetty` を見つけられず失敗する問題）
だけを足したもの。検索の挙動は upstream と同じ。

# デモ: ブラウザで両方の網を検索する

```sh
docker compose -f compose.demo.yaml -p yacydemo up -d
# → http://localhost:8800 を開く。準備（鍵と信頼の一覧の配布、P2P 網の接続、crawl）の進み具合もここに出る。10 分ほどかかる
docker compose -f compose.demo.yaml -p yacydemo down -v   # 片付け
```

YaCy 本家 3 ノード（up-1..3）と改善版 6 ノード（実験 2 と同じ fork-1..3 / ads-1 / evil-1 / NAT の内側の nat-1 + リレー）を立て、
同じサイトを crawl させる。本家側では up-2 が広告頁、up-3 がスパム頁も持つ（本家には信頼の仕組みが無いので、網の誰かが持てば出る）。
画面では同じクエリを両方の網に global 検索で投げ、結果を左右に並べる。

- 各結果に、そのサイトを crawl したノード、正解 / 罠 / スパム / 広告 / NAT の内側の印、改善版では作者の署名の判定（検証済み / 未検証）とタグが付く。
- 「開放モード」「広告（ads タグ）を除外」は改善版の問い合わせ元ノードの設定（`trust.search.acceptUnverified`, `trust.policy.excludeTags`）を切り替える。
- 「コーディネータと信頼の一覧」の欄で、信頼の設定を画面から変えられる。
  - 問い合わせ元が信頼するコーディネータを選ぶ。A（デモの運営者）と B（一覧は evil-1 だけの別の運営者）の両方にすると evil-1 のスパムが「検証済み」になる。どちらも外すと自分の文書だけ、または「署名されたピアすべて」（`trust.signedOnly`）。
  - コーディネータ A の一覧を編集する（信頼する / しない、優先度、タグ）。署名して新しい版として配る。全ノードに渡すか、fork-2 にだけ渡してピア間の交換（`TV`）で広がるのを見る。
  - A からオペレータへの委任を失効させる / し直す。
  - 各ノードが持っている一覧の版は「網の状態」の表に出る。変更が届くまで数十秒かかる。
  - 鍵と一覧の状態は volume `demo_state` に保存され、デモを再起動しても同じコーディネータのまま（`down -v` で消える）。
- 結果はまず届いた順に出て、待ち時間（既定 5 秒）の後に順位どおりに並べ直す。
- 結果のリンクは lab サーバーの頁を画面経由で開く（`*.lab` はホストから名前解決できないため）。
- 各ノードの YaCy 管理画面は既定では公開しない（既定のパスワード admin / yacy のままで、ほかの Web ページから DNS rebinding で
  操作されうるため）。開くなら `compose.demo.admin.yaml` を重ねる: `docker compose -f compose.demo.yaml -f compose.demo.admin.yaml -p yacydemo up -d`
  で、改善版 http://localhost:8811 〜 8815（fork-1..3, ads-1, evil-1）、本家 http://localhost:8821 〜 8823。nat-1 は NAT の内側なので開けない。
- デモのサーバーは Host が `localhost:8800` / `127.0.0.1:8800` の要求だけに答え、設定を変える要求（検索・信頼の設定）は同じ
  オリジンの POST だけを受け付ける。結果の頁は corpus の頁だけを、スクリプトを動かさない形で表示する。
  ポートを変えて公開する（`ports: ["127.0.0.1:9000:8800"]`）なら `DEMO_PUBLIC_PORT=9000`、別の名前で開くなら
  `DEMO_HOSTS=demo.example:443` のように demo サービスの環境変数で足す。
- サイドカー（`*-p2p`）は YaCy のコンテナとネットワーク名前空間を共有する。YaCy のコンテナを作り直した
  （`up -d` で設定が変わった、`rm` した）ときは、サイドカーも `docker compose ... up -d --force-recreate fork-1-p2p` のように
  作り直す。YaCy の再起動だけなら、サイドカーは YaCy に届かなくなって 3 分で終了し、再起動の方針で入り直す。

必要なメモリは 7GB ほど（YaCy 9 ノード、ヒープは各 500MB）。実験 2 と同じサブネットを使うので、実験 2 と同時には動かせない。

# 実験 1: 検索品質

upstream 3 ノードとフォーク 3 ノードを、それぞれ閉じた P2P 網として同時に立てる。同じコーパスを crawl させ、
同じクエリを 1 番ノードに `resource=global` で投げて上位 10 件を採点する。

```
          net-upstream                          net-fork
  ┌────────────────────────────┐      ┌────────────────────────────┐
  │ up-1 ─── up-2 ─── up-3     │      │ fork-1 ─ fork-2 ─ fork-3   │
  │  │        │        │       │      │  │        │        │       │
  │ alpha    beta     gamma    │      │ alpha    beta     gamma    │
  └──┼────────┼────────┼───────┘      └──┼────────┼────────┼───────┘
     └────────┴────────┴──── lab（コーパス配信 + seed list）───┘
```

- ノード i はサイト i だけを crawl する。1 番ノード（alpha.lab 担当）に投げたクエリの正解は主に beta / gamma にあるので、
  **他ピアから結果を集められないと正解が揃わない**。
- 罠頁は 2 種類。クエリの 1 語だけを title と本文に詰め込んだ頁と、クエリの全語をタイトルに持つが中身の薄い「タグ一覧」頁。
  主に gamma に寄せてある。gamma のピアは 1 位が罠になり、upstream のピア単位の正規化でその罠が 1.0 に持ち上がる。
  タグ一覧頁は、タイトルのフレーズ boost が薄い頁を持ち上げないことの確認用。
- 「言い換えの正解」（内容は正解だがクエリ語の一部を別の形で書いた頁）を 3 トピックに置いてある。全語一致を厳しく求めるほど
  これを取りこぼすので、フォークの代償も測れる。
- 他ピアの応答を待つ時間は両クラスタとも 3000 ms にそろえる（フォークの既定は 5000 ms、upstream は 3000 ms）。
- フォークのノードは `trust.signedOnly=true`（コーディネータを置かず、署名された全ピアを信頼する）で動かす。
  信頼の一覧の効果は実験 2 で確かめる。

## 実行

```sh
# 網を立てて、crawl → 評価まで流す（15 分ほど）
docker compose -p yacylab up -d
docker compose -p yacylab run --rm runner            # results/<時刻>.md と results/latest.md に保存

# 評価だけやり直す / 一部だけ
docker compose -p yacylab run --rm runner --skip-crawl --scenarios default,solr-only

# 片付け（索引も消える）
docker compose -p yacylab --profile run down -v
```

1 番ノードの管理画面は upstream が http://127.0.0.1:8190 、フォークが http://127.0.0.1:8290 （admin / yacy）。

## シナリオ

同じ網で、問い合わせ元ノードの設定を実行中に切り替えて同じクエリを投げ直す（`ConfigProperties_p.html`）。
YaCy は同じクエリの結果を 10 分キャッシュするので、どの URL にも一致しない `prefermaskfilter` をシナリオごとに変えて
キャッシュの鍵だけを変えている。

| シナリオ | 経路 | 何が比べられるか |
|---|---|---|
| `default` | 既定の global 検索 | そのままの挙動。upstream は新規ピアを DHT 検索先にしないため他ピアへは Solr だけ。フォークは他ピアを DHT 検索先にし、そのぶん Solr の追加問い合わせ先から外れる |
| `solr-only` | 自ピア Solr + 全ピアへの remote Solr（RWI は切る。フォークも DHT 検索の最低年齢を 3 日に戻す） | 両クラスタが同じ経路になる。mm・被覆率の重み・CJK bigram の Solr 側の差だけが出る |
| `rwi-only` | 自ピア RWI + DHT 検索（Solr は切る） | 単語索引の CJK bigram 化と DHT 検索先の年齢制限の差 |
| `solr-only:mm=1` 他 3 つ | フォークのみ。`solr-only` から改善を 1 つずつ設定で切る / 変える | 各改善の寄与と、厳しい mm の代償 |

## 指標

クエリごとに上位 10 件を採点して平均する。R はそのクエリの正解頁数（4 か 5）。

| 指標 | 定義 |
|---|---|
| R-prec | 上位 R 件のうち正解の割合。並びの良さ |
| recall@10 | 上位 10 件に入った正解の割合。他ピアの頁を集められたか |
| decoy@R | 上位 R 件に入った罠頁（詰め込み頁・タグ一覧頁）の割合（低いほど良い）。このコーパスでは一致する頁が正解か罠のどちらかなので、ほぼ 1 − R-prec になる |
| allTerms@10 | 上位 10 件のうち、クエリの全語を title / URL に含む割合。検索は `verify=false` で snippet が返らないので、実際にはタイトルと URL だけで判定している（全語をタイトルに持つタグ一覧頁は「含む」、タイトルにクエリ語の無い正解頁は「含まない」になる）。公開網の評価（snippet あり）とは同じ値にならない |
| remote@10 | 上位 10 件のうち、問い合わせ元以外のノードが crawl したサイトの頁の割合 |

## 結果

`results/latest.md` が最新の全結果（クエリごとの上位 10 件の判定を含む）。以下は 2026-09-29 の 2 回の実行
（`results/2026-09-29T02-47-37-519Z.md`, `results/2026-09-29T03-06-15-861Z.md`、全 11 クエリの平均。2 回目のレビューの修正を含む版）。
2 回の差は fork / default の R-prec（0.86 と 0.79）だけ。default は他ピアの答えが届く順に左右されるので、範囲で示す。
タグ一覧頁の平均順位は 2026-09-27 の実行から数えたもの。

| クラスタ / シナリオ | R-prec ↑ | recall@10 ↑ | decoy@R ↓ | allTerms@10 ↑ | remote@10 |
|---|---:|---:|---:|---:|---:|
| upstream / default | 0.52 | 0.96 | 0.48 | 0.42 | 0.82 |
| **fork / default** | **0.79–0.86** | **1.00** | **0.14–0.21** | **0.75** | 0.98 |
| upstream / solr-only | 0.52 | 0.96 | 0.48 | 0.42 | 0.82 |
| **fork / solr-only** | **0.77** | **1.00** | **0.23** | **0.75** | 0.98 |
| upstream / rwi-only | 0.02 | 0.02 | 0.00 | 0.09 | 0.00 |
| **fork / rwi-only** | **0.93** | 0.95 | **0.07** | 0.77 | 0.98 |

罠頁は 2 種類ある。1 語だけの詰め込み頁と、クエリの全語をタイトルに持つが本文の薄い「タグ一覧」頁。

- **詰め込み頁はフォークで上位から消える。** 上位 5 件に入った数（solr-only、11 クエリの合計）は upstream 14、フォーク 0。
  upstream では問い合わせ元ノード自身が持つ詰め込み頁が上位に入る。自ノードの Solr には罠しか一致しないので、
  ピアごとの正規化でそれが 1.0 になるため。フォークは mm と被覆率の重みでこれを除く。
- **タグ一覧頁は本文の薄さの重み（`search.ranking.thin.words`）で下がる。** 全語をタイトルに持つので mm も被覆率も通り抜け、
  title^5・h1^5 の重みで本文より強く一致する。タグ一覧頁の平均順位（11 クエリ）:

  | シナリオ | 重みなし（`thin.words=0`） | 重みあり（既定） |
  |---|---:|---:|
  | solr-only | 2.0 | 3.1 |
  | default | ― | 4.5 |
  | rwi-only | ― | 5.0 |

  重みありでは、クエリ語をタイトルに持つ正解頁よりは必ず下になる。タイトルにクエリ語を持たない正解頁（「Notes, part 2」など）は
  Solr の点数がもともと 3 倍ほど低く、solr-only ではタグ一覧頁の方が上に残る（decoy@R 0.23 はこれ）。重みを強めれば（指数 2 など）
  逆転するが、短い正当な頁も大きく下げるので、既定は線形（指数 1、100 語未満から）にとどめた。
- **fork / default の recall は 1.00。** 以前は他ピアを DHT 検索先にすると Solr の問い合わせ先から外していたため、全語を要求する
  単語索引の検索だけになり、言い換えの正解（PostgreSQL / evicts / 金融庁なし）を落としていた（0.95）。DHT 転送をしない小さな網では
  DHT 検索先にも Solr で問い合わせるようにした。
- **rwi-only**: upstream は他ピアの単語索引を一切引けない（新規ピアは DHT 検索先にならない）。日本語・中国語は自ピアの索引でも 0 件
  （句読点までが 1 語になるため）。フォークは DHT 検索で他ピアの索引を引き、CJK も bigram で一致する。

### 内訳（フォークのみ、solr-only から設定を 1 つずつ変える）

| 設定 | R-prec | recall@10 | decoy@R | allTerms@10 |
|---|---:|---:|---:|---:|
| 既定（mm `2<-1 5<80%` + 被覆率の重み + title の phrase boost 20 + 薄さの重み） | 0.77 | 1.00 | 0.23 | 0.75 |
| 被覆率の重みを切る（mm だけ） | 0.77 | 1.00 | 0.23 | 0.75 |
| mm を 1 に戻す（被覆率の重みだけ） | 0.66 | 0.98 | 0.34 | 0.42 |
| mm と被覆率の重みを両方切る | 0.56 | 0.96 | 0.44 | 0.42 |
| title の phrase boost を切る（`search.ranking.solr.titlePhraseBoost=0`） | 0.81 | 1.00 | 0.19 | 0.75 |
| 薄さの重みを切る（`search.ranking.thin.words=0`） | 0.77 | 1.00 | 0.23 | 0.75 |
| mm を 100% にする | 0.77 | 0.95 | 0.23 | 0.78 |

- mm と被覆率の重みを両方切るとほぼ upstream と同じ値に戻る。詰め込み頁への効果は mm と被覆率の重みから来ている。
- 薄さの重みは R-prec（上位 R 件）には出ないが、タグ一覧頁の順位を下げる（上の表）。
- title の phrase boost を切ると、この 2 回ではタグ一覧頁がもう 1 つ下がった（0.77 → 0.81）。既定は変えていない（1 つのコーパスで決めない）。
- mm を 100% にすると言い換えの正解を落とす（recall 0.95）。フォークの既定を `2<-1 5<80%`（2 語は両方必須、3 語以上は 1 語の欠けを許す）に
  したのはこのため。**この値はこのコーパスを見て選んだので、公開網での妥当性は別途確かめる必要がある。**

# 実験 2: 信頼と NAT 越え

設計はフォークの [docs/trust-and-nat.md](https://github.com/pad01g/yacy_search_server/blob/improved-search/docs/trust-and-nat.md)。
フォーク版だけで組む。

```
                          pub 172.30.0.0/24
  lab .2   relay .3   fork-1..3 .11-.13   ads-1 .14   evil-1 .15   router .254
                                                                       │ MASQUERADE
                          natlan 172.31.0.0/24                          │
  natbox .10（nat-1 と nat-1-p2p がこの名前空間を使う） ─── default via router .254
```

| ノード | 役 |
|---|---|
| `fork-1` 〜 `fork-3` | 信頼集合（優先度 100）。それぞれ alpha / beta / gamma.lab を crawl。検索は `fork-1` から出す |
| `ads-1` | 信頼集合（優先度 80、タグ `ads`）。`ads.lab`（広告頁）を crawl |
| `evil-1` | 署名はあるが信頼集合外。`spam.lab`（クエリの全語を含むマルウェア誘導頁）を crawl。さらに fork-2 の本物の署名を流用して作者を偽った文書と、署名の無い文書を自分の索引に入れる |
| `nat-1` | NAT（MASQUERADE するルーター）の内側。`delta.lab` を crawl。公開側からは直接届かず、sidecar とリレー経由でだけ届く |
| `relay` | circuit relay v2 のリレー（sidecar の `-relay-service`） |
| `*-p2p` | 各ピアの sidecar。YaCy と同じネットワーク名前空間で、YaCy の鍵とトークンを読むため同じ uid（100:101）で動く |

runner はコーディネータ鍵とオペレータ鍵を作り、各ピアの `trust.coordinators` に設定し、署名した一覧を fork-1 だけに渡す
（他のピアは `TV` の交換で取り込む）。そのあと crawl して、次の検査を順に行う。

| id | 確かめること |
|---|---|
| S0–S2 | 前提: fork-2 の文書に作者の署名がある / 偽の作者の文書が evil-1 の索引にある / evil-1 作者の文書を信頼ピア fork-2 の索引にも入れた |
| C1 | すべての seed が署名付きで、ピア ID = base64url(SHA-256(公開鍵)) の先頭 12 文字 |
| C2 | fork-1 が一覧 v1 を取り込む |
| C3, C3b | 既定では信頼集合外の作者（spam.lab）の結果が出ない。信頼ピアが持っていても出ない |
| C4a–e | 開放モードでは「未検証」として出て、必ず検証済みの下に並ぶ。作者を偽った文書は開放モードでも出ない。署名の無い文書は開放モードでだけ出る |
| C5a, C5b | ads を宣言したピアの結果に `ads` タグが付く。`excludeTags=ads` で消える |
| C6a–f | 公開側から nat-1 に直接届かない。nat-1 の seed は `Reach=relay` で DHT の保存先を申し出ない。fork-1 の検索で nat-1 だけが持つ頁がリレー経由で見つかる。fork-1 から nat-1 へのトンネル経由の peer ping も通り、nat-1 が接続中のまま保たれる。nat-1 を leecher にすると見つからない |
| C9 | 公開側のピアはリレー経由にならない |
| C7a, C7b | fork-1 は設定を変えずにピア間の交換で一覧 v2 を取り込み、v2 で外した fork-3 の結果が消える |
| C8a–c | オペレータの委任を失効させると、その一覧のピアの結果が消えて自ピアの結果だけが残る。開放モードなら同じ結果が「未検証」で出る（対照） |

```sh
docker compose -f compose.trust.yaml -p yacytrust up -d
docker compose -f compose.trust.yaml -p yacytrust run --rm runner    # results/trust-<時刻>.md と results/trust-latest.md
docker compose -f compose.trust.yaml -p yacytrust --profile run down -v
```

fork-1 の管理画面は http://127.0.0.1:8390 （admin / yacy）。NAT の判定を固定したいときは
`NAT_REACHABILITY=private docker compose -f compose.trust.yaml ...`（既定 `auto`: AutoNAT が判定を出せない私設網では、
「public」と判定されない限りリレーに予約を取る）。

## 結果（信頼と NAT 越え）

`results/trust-latest.md` が最新の全結果。2026-09-29 の実行（2 回目のレビューの修正を含む版）でも **26 / 26 の検査がすべて通った**（`results/trust-2026-09-29T02-28-37-120Z.md`。前回は `results/trust-2026-09-27T11-28-17-448Z.md`）。

- 既定の検索（fork-1）では spam.lab の頁が 0 件。信頼ピア fork-2 の索引に入れた evil-1 作者の文書も出ない（作者の署名で落とす）。
  開放モードでは spam.lab の 6 件が「未検証」として検証済み 5 件の後ろに並ぶ。fork-2 の署名を流用した偽の文書は開放モードでも出ない。
- ads.lab の頁には `ads` タグが付き、`excludeTags=ads` で消える。
- nat-1 は `Reach=relay` になり、公開側から直接届かないのに fork-1 の検索で delta.lab の 4 件がリレー経由で返る。
- 一覧 v2 は fork-2 にだけ渡したが、fork-1 は `TV` の交換で取り込み、外した fork-3 の頁が消えた。委任の失効で、その一覧のピアの結果が消えた。

## 構成

| パス | 役割 |
|---|---|
| `compose.yaml` | 実験 1: lab / up-1..3 / fork-1..3 / runner |
| `compose.demo.yaml` | デモ: lab / demo / 実験 2 の構成 / up-1..3 |
| `compose.trust.yaml` | 実験 2: lab / relay / fork-1..3 / ads-1 / evil-1 / router / natbox / nat-1 / 各 sidecar / runner |
| `lab/corpus.ts` | コーパスと正解集合を決定的に生成する（実験 1: 11 トピック・160 頁、英語 6・日本語 4・中国語 1 / 実験 2: spam・ads・delta.lab の頁） |
| `lab/server.ts` | Host ヘッダごとにコーパスを配る。`/seed/<cluster>.txt` で各ノードの seed を集めて配る。runner が置いたファイル（一覧・取り込み用の文書）を `/files/` で配る。`/probe` で公開側からの到達性を調べる |
| `lab/run.ts` | 実験 1: ピア接続待ち → crawl → 索引待ち → シナリオごとの評価 → `results/` |
| `lab/trust.ts` | 実験 2: 鍵と一覧の作成・配布 → crawl → 検査 → `results/trust-*.md` |
| `lab/trustlib.ts` | 実験 2 とデモが共有する、信頼の網を組む部分（鍵・一覧の封筒・接続待ち・crawl） |
| `lab/demo.ts`, `lab/demo/index.html` | デモの画面と API（網の準備、両方の網への検索、頁の表示） |
| `lab/demotrust.ts` | デモの信頼の設定（コーディネータ A / B の鍵と一覧、署名と配布、問い合わせ元の設定） |
| `lab/yacy.ts` | YaCy の HTTP API クライアント（Digest 認証、transactionToken） |
| `yacy/entry.sh`, `yacy/yacy.conf`, `yacy/yacy.trust.conf` | 初回起動時に lab 用の設定を `DATA/SETTINGS/yacy.conf` に置く（`STATIC_IP`, `YACY_CONF` で追加の設定） |
| `yacy/yacy.network.*.unit` | 閉じた網の定義（クラスタごとに seed list の URL だけ違う） |

### 閉じた網を compose で組むために必要だったこと

公開網向けの既定のままでは、新規ピアだけの網は互いを見つけられず、見つけても検索が他ピアへ飛ばない。

1. **seed list に `Last-Modified` が要る。** 無いと捨てられる。lab サーバーが付ける。
2. **virgin ピアは IP を知らない。** 自分の seed に IP が載らず、他ピアから接続できない。`entry.sh` が `staticIP` にコンテナの IP を入れる。
3. **virgin / junior の seed は受け入れられない。** 全員が同時に起動すると誰も senior にならない。lab サーバーは配る seed の
   `PeerType` を senior に書き換える。接続後は hello の往復で各ピアが実際の到達性から種別を決め直す。
4. **ホスト名が短すぎると seed list の URL が拒否される**（`lab` は不可、`seed.lab` は可）。
5. **remote Solr 検索の送り先数は `2^partitionExponent × redundancy / 2`。** `intranet` などの定義（0 / 1）だと 0 台になる。
   網の定義で 2 / 2 にしている（フォークは 32 ピア以下なら全ピアに送るよう直した）。
6. **load average が 4 を超えると remote Solr 検索を送らず、peer ping（seed の交換）も止まる。** 1 台の Docker で 6〜9 ノードを動かすと超えるので、
   `remotesearch.maxload.*` と `30_peerping_loadprereq` を上げている（peer ping が止まると、起動後しばらく網がつながらない）。
7. **DHT 検索先はピア年齢 3 日以上。** upstream では変えられない。フォークは `remotesearch.dht.minage` で 0 にしている。
8. **（実験 2）NAT の内側の網を `internal: true` にすると、ルーター経由の転送もホストの iptables に捨てられる。** natlan は通常の網にし、
   公開側から natlan への経路が無いこと（Docker の網の分離）で「外から届かない」を作っている。C6a で確かめている。
9. **（実験 2）AutoNAT は私設アドレスしか無い網では判定を出さない。** sidecar は「public」と判定されていない間は自分からリレーに予約を取る。

## 限界

- コーパスは公開網の測定で見つけた弱点（1 語一致の罠、ピア単位の正規化、CJK の分かち書き）を再現するように作った人工のもので、
  160 頁と小さい。改善が効く方向の差は出るが、数値の大きさは公開網での改善幅をそのまま示すものではない。
- 各シナリオは 1 回ずつの測定。コーパスとクエリは決定的なので結果はほぼ再現するが、remote 検索の応答時間によっては順位が入れ替わりうる。
- 言い換えの正解は 3 件だけで、厳しい minimum match の代償を網羅的には測っていない。
- 実験 2 の NAT は Docker の 1 段の MASQUERADE で、実際の家庭用ルーター（ポート制限・対称 NAT）とは違う。DCUtR（穴あけ）の成否は測っていない。
- 実験 2 の攻撃者は 1 ピアで、索引に直接書き込める程度の能力を想定している。hello のチャレンジの転送攻撃（設計書 §11）は試していない。
