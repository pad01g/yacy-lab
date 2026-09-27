# yacy-lab

YaCy の検索品質の改善（フォーク [pad01g/yacy_search_server](https://github.com/pad01g/yacy_search_server) branch `improved-search`）が
P2P 網で効いているかを、docker compose だけで再現して測る実験。

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
- 罠頁（クエリの 1 語だけを title と本文に詰め込んだ頁）は gamma に寄せてある。gamma のピアは 1 位が罠になり、
  upstream のピア単位の正規化でその罠が 1.0 に持ち上がる。
- 「言い換えの正解」（内容は正解だがクエリ語の一部を別の形で書いた頁）を 3 トピックに置いてある。全語一致を厳しく求めるほど
  これを取りこぼすので、フォークの代償も測れる。

## 実行

必要なもの: Docker（メモリ 7GB 程度。YaCy 6 ノード × 約 0.3〜1GB）。

```sh
# 1. イメージを用意する（両方とも docker/Dockerfile からビルド）
git clone https://github.com/pad01g/yacy_search_server.git yacy && cd yacy
git checkout baseline      && docker build -t yacy-lab/upstream:baseline -f docker/Dockerfile .   # upstream b50b76b + ビルド修正のみ
git checkout improved-search && docker build -t yacy-lab/fork:latest    -f docker/Dockerfile .
cd ..

# 2. 網を立てて、crawl → 評価まで流す（15 分ほど）
docker compose -p yacylab up -d
docker compose -p yacylab run --rm runner            # results/<時刻>.md と results/latest.md に保存

# 評価だけやり直す / 一部だけ
docker compose -p yacylab run --rm runner --skip-crawl --scenarios default,solr-only

# 片付け（索引も消える）
docker compose -p yacylab --profile run down -v
```

1 番ノードの管理画面は upstream が http://127.0.0.1:8190 、フォークが http://127.0.0.1:8290 （admin / yacy）。

`baseline` タグは upstream `b50b76b` に `.dockerignore` の修正（`docker build` が `test/jetty` を見つけられず失敗する問題）
だけを足したもの。検索の挙動は upstream と同じ。

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
| decoy@R | 上位 R 件に入った罠頁の割合（低いほど良い） |
| allTerms@10 | 上位 10 件のうち、クエリの全語を title / snippet / url に含む割合（`client/src/eval.ts` の公開網評価と同じ定義） |
| remote@10 | 上位 10 件のうち、問い合わせ元以外のノードが crawl したサイトの頁の割合 |

## 結果

`results/latest.md` が最新の全結果（クエリごとの上位 10 件の判定を含む）。以下は 2026-09-27 の実行（全 11 クエリの平均）。

| クラスタ / シナリオ | R-prec ↑ | recall@10 ↑ | decoy@R ↓ | allTerms@10 ↑ | remote@10 |
|---|---:|---:|---:|---:|---:|
| upstream / default | 0.79 | 0.98 | 0.21 | 0.43 | 0.89 |
| **fork / default** | **0.95** | 0.95 | **0.00** | **0.93** | 0.98 |
| upstream / solr-only | 0.79 | 0.98 | 0.21 | 0.43 | 0.89 |
| **fork / solr-only** | **1.00** | **1.00** | **0.00** | **0.90** | 0.98 |
| upstream / rwi-only | 0.02 | 0.02 | 0.00 | 0.09 | 0.00 |
| **fork / rwi-only** | **0.95** | 0.95 | 0.00 | 0.93 | 0.98 |

- **同じ経路（solr-only）での比較**: upstream は上位 R 件の 21% が罠頁（1 語だけの詰め込み頁）。11 クエリ中 10 で、問い合わせ元ノード自身が持つ罠頁が 2〜3 位に入っている。
  自ノードの Solr には罠しか一致しないので、ピアごとの正規化でそれが 1.0 になる。フォークは罠頁を上位から追い出し、言い換えの正解も含めて全正解を上位に並べた。
- **rwi-only**: upstream は他ピアの単語索引を一切引けない（新規ピアは DHT 検索先にならない）。日本語・中国語は自ピアの索引でも 0 件
  （句読点までが 1 語になるため）。フォークは DHT 検索で他ピアの索引を引き、CJK も bigram で一致する。
- **fork / default が 0.95 の理由**: フォークは他ピアを DHT 検索先にするので、Solr の追加問い合わせ先から外れ、結果は主に RWI から来る。
  RWI の結合は全語を要求するので、言い換えの正解 3 件（PostgreSQL / evicts / 金融庁なし）を落とす。

### 内訳（フォークのみ、solr-only から設定を 1 つずつ変える）

| 設定 | R-prec | recall@10 | decoy@R | allTerms@10 |
|---|---:|---:|---:|---:|
| 既定（mm `2<-1 5<80%` + 被覆率の重み） | 1.00 | 1.00 | 0.00 | 0.90 |
| 被覆率の重みを切る（mm だけ） | 1.00 | 1.00 | 0.00 | 0.90 |
| mm を 1 に戻す（被覆率の重みだけ） | 0.96 | 1.00 | 0.04 | 0.43 |
| 両方切る | 0.79 | 0.96 | 0.21 | 0.42 |
| mm を 100% にする | 0.95 | 0.95 | 0.00 | 0.95 |

- 両方切るとほぼ upstream と同じ値に戻る。フォーク内で upstream の挙動を再現できており、差は mm と被覆率の重みから来ている
  （schema の CJK bigram と title の phrase boost はこのコーパスでは順位を変えていない）。
- mm と被覆率の重みはどちらか片方でも大半の罠を除く。mm は罠を結果から消し、被覆率の重みは罠を下位に送る（結果には残るので allTerms は低い）。
- mm を 100% にすると言い換えの正解を落とす。フォークの既定を `2<-1 5<80%`（2 語は両方必須、3 語以上は 1 語の欠けを許す）にしたのはこのため。
  **この値はこのコーパスを見て選んだので、公開網での妥当性は別途確かめる必要がある。**

## 構成

| パス | 役割 |
|---|---|
| `compose.yaml` | lab / up-1..3 / fork-1..3 / runner |
| `lab/corpus.ts` | コーパスと正解集合を決定的に生成する（11 トピック: 英語 6、日本語 4、中国語 1） |
| `lab/server.ts` | Host ヘッダごとにコーパスを配る。`/seed/<cluster>.txt` で各ノードの seed を集めて配る |
| `lab/run.ts` | ピア接続待ち → crawl → 索引待ち → シナリオごとの評価 → `results/` |
| `lab/yacy.ts` | YaCy の HTTP API クライアント（Digest 認証、transactionToken） |
| `yacy/entry.sh`, `yacy/yacy.conf` | 初回起動時に lab 用の設定を `DATA/SETTINGS/yacy.conf` に置く |
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

## 限界

- コーパスは公開網の測定で見つけた弱点（1 語一致の罠、ピア単位の正規化、CJK の分かち書き）を再現するように作った人工のもので、
  149 頁と小さい。改善が効く方向の差は出るが、数値の大きさは公開網での改善幅をそのまま示すものではない。
- 各シナリオは 1 回ずつの測定。コーパスとクエリは決定的なので結果はほぼ再現するが、remote 検索の応答時間によっては順位が入れ替わりうる。
- 言い換えの正解は 3 件だけで、厳しい minimum match の代償を網羅的には測っていない。
