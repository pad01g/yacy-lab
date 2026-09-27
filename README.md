# yacy-lab

YaCy のフォーク [pad01g/yacy_search_server](https://github.com/pad01g/yacy_search_server)（branch `improved-search`）の改善が
P2P 網で効いているかを、docker compose だけで再現して確かめる実験。2 つある:

| 実験 | compose | 何を確かめるか |
|---|---|---|
| **検索品質** | `compose.yaml`（`-p yacylab`） | upstream 3 ノードとフォーク 3 ノードの閉じた網で、同じクエリの上位 10 件を採点して比べる |
| **信頼と NAT 越え** | `compose.trust.yaml`（`-p yacytrust`） | フォーク 6 ピア + リレー + NAT で、seed の署名・信頼の一覧・宣言タグ・偽の作者・NAT 越え・一覧の更新と失効を合否で確かめる |

どちらもインターネット上の YaCy 網には接続しない（閉じた網。ただし NAT 実験のルーターは起動時に `apk add` するため外向きの通信が要る）。

## 準備

必要なもの: Docker（メモリ 8GB 程度。YaCy 1 ノードあたり上限 1.1GB）。

```sh
git clone https://github.com/pad01g/yacy_search_server.git yacy && cd yacy
git checkout baseline        && docker build -t yacy-lab/upstream:baseline -f docker/Dockerfile .   # upstream b50b76b + ビルド修正のみ
git checkout improved-search && docker build -t yacy-lab/fork:latest    -f docker/Dockerfile .
docker build -t yacy-lab/sidecar:latest sidecar/                                                     # NAT 越えの sidecar（信頼の実験だけ）
cd ..
```

`baseline` タグは upstream `b50b76b` に `.dockerignore` の修正（`docker build` が `test/jetty` を見つけられず失敗する問題）
だけを足したもの。検索の挙動は upstream と同じ。

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
| decoy@R | 上位 R 件に入った罠頁（詰め込み頁・タグ一覧頁）の割合（低いほど良い） |
| allTerms@10 | 上位 10 件のうち、クエリの全語を title / snippet / url に含む割合（公開網を測ったときの評価スクリプトと同じ定義） |
| remote@10 | 上位 10 件のうち、問い合わせ元以外のノードが crawl したサイトの頁の割合 |

## 結果

`results/latest.md` が最新の全結果（クエリごとの上位 10 件の判定を含む）。以下は 2026-09-27 の 2 回の実行
（`results/2026-09-27T08-28-06-496Z.md`, `results/2026-09-27T08-48-31-443Z.md`、全 11 クエリの平均）。
2 回の差は fork / default の R-prec（0.79 と 0.77）と fork / mm=1+no-cov（0.51 と 0.54）だけで、他はすべて同じ値。表は 2 回目。

| クラスタ / シナリオ | R-prec ↑ | recall@10 ↑ | decoy@R ↓ | allTerms@10 ↑ | remote@10 |
|---|---:|---:|---:|---:|---:|
| upstream / default | 0.52 | 0.96 | 0.48 | 0.42 | 0.82 |
| **fork / default** | **0.77** | 0.95 | **0.23** | **0.77** | 0.98 |
| upstream / solr-only | 0.52 | 0.96 | 0.48 | 0.42 | 0.82 |
| **fork / solr-only** | **0.77** | **1.00** | **0.23** | **0.75** | 0.98 |
| upstream / rwi-only | 0.02 | 0.02 | 0.00 | 0.09 | 0.00 |
| **fork / rwi-only** | **0.77** | 0.95 | 0.23 | 0.77 | 0.98 |

上位 5 件に入った罠頁の内訳（solr-only、11 クエリの合計）:

| | 詰め込み頁（1 語だけ） | タグ一覧頁（全語をタイトルに持つ薄い頁） |
|---|---:|---:|
| upstream | 14 | 11 |
| fork | **0** | 11 |

- **詰め込み頁はフォークで上位から消える。** upstream では問い合わせ元ノード自身が持つ詰め込み頁が上位に入る。自ノードの Solr には
  罠しか一致しないので、ピアごとの正規化でそれが 1.0 になるため。フォークは mm と被覆率の重みでこれを除く。
- **タグ一覧頁はどちらでも全クエリで上位 5 件に残る（フォークの decoy@R 0.23 はすべてこれ）。** 全語をタイトルに持つので mm も被覆率も
  通り抜け、それを持つ gamma のピアの中でも最上位になる。日本語・中国語のクエリでは 1 位に来る。タイトルのフレーズ boost を切っても
  変わらない（下の表）ので、原因は boost ではない。本文の薄さ（語数・リンクだけの頁）で減点する仕組み（計画の A5）が要るが、未実装。
- **rwi-only**: upstream は他ピアの単語索引を一切引けない（新規ピアは DHT 検索先にならない）。日本語・中国語は自ピアの索引でも 0 件
  （句読点までが 1 語になるため）。フォークは DHT 検索で他ピアの索引を引き、CJK も bigram で一致する。
- **fork / default の recall が 0.95 の理由**: フォークは他ピアを DHT 検索先にするので、Solr の追加問い合わせ先から外れ、結果は主に RWI から来る。
  RWI の結合は全語を要求するので、言い換えの正解（PostgreSQL / evicts / 金融庁なし）を落とす。

### 内訳（フォークのみ、solr-only から設定を 1 つずつ変える）

| 設定 | R-prec | recall@10 | decoy@R | allTerms@10 |
|---|---:|---:|---:|---:|
| 既定（mm `2<-1 5<80%` + 被覆率の重み + title の phrase boost 20） | 0.77 | 1.00 | 0.23 | 0.75 |
| 被覆率の重みを切る（mm だけ） | 0.77 | 1.00 | 0.23 | 0.75 |
| mm を 1 に戻す（被覆率の重みだけ） | 0.66 | 0.98 | 0.34 | 0.42 |
| 両方切る | 0.54 | 0.96 | 0.46 | 0.42 |
| title の phrase boost を切る（`search.ranking.solr.titlePhraseBoost=0`） | 0.77 | 1.00 | 0.23 | 0.75 |
| mm を 100% にする | 0.77 | 0.95 | 0.23 | 0.78 |

- mm と被覆率の重みを両方切るとほぼ upstream と同じ値に戻る。差は mm と被覆率の重みから来ている。
- mm は詰め込み頁を結果から消す。被覆率の重みだけでも詰め込み頁の大半を下位へ送るが、結果には残る（allTerms が低い）。
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
| C6a–e | 公開側から nat-1 に直接届かない。nat-1 の seed は `Reach=relay` で DHT の保存先を申し出ない。fork-1 の検索で nat-1 だけが持つ頁がリレー経由で見つかる。nat-1 を leecher にすると見つからない |
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

`results/trust-latest.md` が最新の全結果。2026-09-27 の実行で **25 / 25 の検査がすべて通った**（`results/trust-2026-09-27T07-39-46-247Z.md`）。

- 既定の検索（fork-1）では spam.lab の頁が 0 件。信頼ピア fork-2 の索引に入れた evil-1 作者の文書も出ない（作者の署名で落とす）。
  開放モードでは spam.lab の 6 件が「未検証」として検証済み 5 件の後ろに並ぶ。fork-2 の署名を流用した偽の文書は開放モードでも出ない。
- ads.lab の頁には `ads` タグが付き、`excludeTags=ads` で消える。
- nat-1 は `Reach=relay` になり、公開側から直接届かないのに fork-1 の検索で delta.lab の 4 件がリレー経由で返る。
- 一覧 v2 は fork-2 にだけ渡したが、fork-1 は `TV` の交換で取り込み、外した fork-3 の頁が消えた。委任の失効で、その一覧のピアの結果が消えた。

## 構成

| パス | 役割 |
|---|---|
| `compose.yaml` | 実験 1: lab / up-1..3 / fork-1..3 / runner |
| `compose.trust.yaml` | 実験 2: lab / relay / fork-1..3 / ads-1 / evil-1 / router / natbox / nat-1 / 各 sidecar / runner |
| `lab/corpus.ts` | コーパスと正解集合を決定的に生成する（実験 1: 11 トピック・160 頁、英語 6・日本語 4・中国語 1 / 実験 2: spam・ads・delta.lab の頁） |
| `lab/server.ts` | Host ヘッダごとにコーパスを配る。`/seed/<cluster>.txt` で各ノードの seed を集めて配る。runner が置いたファイル（一覧・取り込み用の文書）を `/files/` で配る。`/probe` で公開側からの到達性を調べる |
| `lab/run.ts` | 実験 1: ピア接続待ち → crawl → 索引待ち → シナリオごとの評価 → `results/` |
| `lab/trust.ts` | 実験 2: 鍵と一覧の作成・配布 → crawl → 検査 → `results/trust-*.md` |
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
6. **load average が 4 を超えると remote Solr 検索を送らない。** 1 台の Docker で 6 ノードを動かすと超えるので閾値を上げている。
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
