# yacy-lab trust and NAT test

- at: 2026-09-27T11:28:17.448Z
- result: all passed (26/26 checks passed)

| id | check | result | detail |
|---|---|---|---|
| S0 | fork-2 の索引の文書に作者の署名が付いている | PASS | 1\|hNWJNThhGJ7vKhV2xyRtCJnu3gNLC3qMZsQ7bMw3GL8\|xqkqmORH6h4V8E… |
| S1 | 作者を偽った文書が、流用した署名付きのまま evil-1 の索引にある | PASS | {"sku":"http://spam.lab/forged.html","provenance_s":"1\|hNWJNThhGJ7vKhV2xyRtCJnu3gNLC3qMZsQ7bMw3GL8\|xqkqmORH6h4V8E1a6N5WY |
| S2 | evil-1 が署名した文書が、そのまま信頼ピア fork-2 の索引にある | PASS | http://spam.lab/doc/000.html 1\|tTVMcXho7XmEOCfhujcoeedFRR26FqzubKmE30… |
| C1 | 他ピアの seed が署名付きで、ピア ID が公開鍵から導かれている | PASS | agent-gemugik-ufe-0:signed:hash=H(PK) agent-sopokeg-ufe-0:signed:hash=H(PK) agent-dileteh-ufe-0:signed:hash=H(PK) agent-rudorag-ufe-0:signed:hash=H(PK) agent-lubadak-ufe-0:signed:hash=H(PK) |
| C2 | fork-1 が一覧 v1 を取り込んだ | PASS | {"lists":[1],"delegations":[{"version":1,"revoked":false}]} |
| C3 | 既定では信頼集合外の作者（spam.lab）の結果が出ない | PASS | beta.lab gamma.lab beta.lab gamma.lab gamma.lab |
| C3b | 信頼ピア（fork-2）が持っていても、信頼集合外の作者が署名した文書は出ない | PASS | http://spam.lab/doc/000.html not shown |
| C4a | 開放モードでは spam.lab が「未検証」として出る | PASS | gamma.lab beta.lab beta.lab gamma.lab gamma.lab spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) |
| C4b | 未検証の結果は検証済みの結果より必ず下 | PASS | last verified #4, first unverified #5 |
| C4c | 作者を偽った文書（署名の流用）は開放モードでも出ない | PASS | absent |
| C4d | 署名の無い文書は開放モードでだけ「未検証」で出る | PASS | unsigned.html |
| C4e | C3b の対照: 開放モードなら fork-2 の持つ evil-1 作者の文書は「未検証」で出る | PASS | http://spam.lab/doc/000.html |
| C5a | ads を宣言した信頼ピアの結果に ads タグが付く | PASS | beta.lab beta.lab gamma.lab gamma.lab gamma.lab ads.lab[ads] ads.lab[ads] ads.lab[ads] ads.lab[ads] beta.lab |
| C5b | excludeTags=ads で ads の作者の結果が消える | PASS | beta.lab gamma.lab beta.lab gamma.lab gamma.lab beta.lab |
| C6a | 公開側から nat-1 の YaCy（8090）にも libp2p（4001）にも直接は届かない | PASS | [{"target":"172.31.0.10:8090","reachable":false},{"target":"172.31.0.10:4001","reachable":false}] |
| C6b | nat-1 の seed は Reach=relay で、リレー経由のアドレスを持つ | PASS | Reach=relay P2PA=/ip4/172.30.0.3/tcp/4001/p2p/12D3KooWM3iLscu8Q2o9peVM8RVmCR7BXAejSbstCmhnytMYt33… |
| C6c | nat-1 は DHT の保存先を申し出ていない（RDS なし） | PASS | RDS=- |
| C6d | fork-1 の global 検索で nat-1 だけが持つ delta.lab の頁が見つかる | PASS | delta.lab delta.lab delta.lab delta.lab |
| C6f | fork-1 は nat-1 を 150 秒間ずっと接続中の senior として保ち、その後の検索でも delta.lab が見つかる | PASS | senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior,senior / delta.lab delta.lab delta.lab delta.lab |
| C6e | nat-1 を leecher にすると delta.lab の頁は見つからない（同じ時点で他のクエリは結果が出る） | PASS | nat: (no results) / control: beta.lab gamma.lab beta.lab gamma.lab gamma.lab |
| C9 | 公開側のピアはリレー経由（Reach=relay）にならない | PASS | fork-1=direct agent-gemugik-ufe-0=direct agent-sopokeg-ufe-0=direct agent-rudorag-ufe-0=direct agent-lubadak-ufe-0=direct |
| C7a | fork-1 は URL を変えていないのに、ピア間の交換で一覧 v2 を取り込む | PASS | {"lists":[2],"delegations":[{"version":1,"revoked":false}]} |
| C7b | v2 で外した fork-3 の頁（gamma.lab）が出なくなる | PASS | beta.lab beta.lab |
| C8a | 失効の前は自ピア以外（beta.lab）の結果も出る（C8b の対照） | PASS | beta.lab beta.lab alpha.lab |
| C8b | 委任を失効させると、そのオペレータの一覧のピアの結果が消え、自ピアの結果だけが残る | PASS | {"lists":[2],"delegations":[{"version":2,"revoked":true}]} alpha.lab |
| C8c | 失効後も開放モードなら beta.lab の結果は「未検証」として出る（C8b の対照） | PASS | alpha.lab gamma.lab(unverified) beta.lab(unverified) beta.lab(unverified) gamma.lab(unverified) gamma.lab(unverified) |
