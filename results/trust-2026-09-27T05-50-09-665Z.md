# yacy-lab trust and NAT test

- at: 2026-09-27T05:50:09.665Z
- result: all passed (18/18 checks passed)

| id | check | result | detail |
|---|---|---|---|
| S0 | fork-2 の索引の文書に作者の署名が付いている | PASS | 1\|Zc9kTub4hrc2Q2yV6Blgfs6hMM57mLyfuO_1JqB51qQ\|TMaP9aq7DjG-hK… |
| C1 | 他ピアの seed が署名付きで、ピア ID が公開鍵から導かれている | PASS | agent-burufom-ufe-0:signed agent-fupotoh-ufe-0:signed agent-rokamog-ufe-0:signed agent-bemosos-ufe-0:signed agent-danabag-ufe-0:signed |
| C2 | fork-1 が一覧 v1 を取り込んだ | PASS | {"lists":[1],"delegations":[{"version":1,"revoked":false}]} |
| C3 | 既定では信頼集合外の作者（spam.lab）の結果が出ない | PASS | beta.lab gamma.lab beta.lab gamma.lab |
| C4a | 開放モードでは spam.lab が「未検証」として出る | PASS | beta.lab gamma.lab beta.lab gamma.lab spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) spam.lab(unverified) |
| C4b | 未検証の結果は検証済みの結果より必ず下 | PASS | last verified #3, first unverified #4 |
| C4c | 作者を偽った文書（署名の流用）は開放モードでも出ない | PASS | absent |
| C4d | 署名の無い文書は開放モードでだけ「未検証」で出る | PASS | unsigned.html |
| C5a | ads を宣言した信頼ピアの結果に ads タグが付く | PASS | beta.lab gamma.lab beta.lab gamma.lab ads.lab[ads] ads.lab[ads] ads.lab[ads] ads.lab[ads] |
| C5b | excludeTags=ads で ads の作者の結果が消える | PASS | beta.lab gamma.lab beta.lab gamma.lab |
| C6a | 公開側から nat-1（172.31.0.10:8090）へ直接は届かない | PASS | {"target":"172.31.0.10:8090","reachable":false} |
| C6b | nat-1 の seed は Reach=relay で、リレー経由のアドレスを持つ | PASS | Reach=relay P2PA=/ip4/172.30.0.3/tcp/4001/p2p/12D3KooWSPQuabWjnyHrUmPHM2KY2vftoHuLHvX6BS1NjFHC842… |
| C6c | nat-1 は DHT の保存先を申し出ていない（RDS なし） | PASS | RDS=- |
| C6d | fork-1 の global 検索で nat-1 だけが持つ delta.lab の頁が見つかる | PASS | delta.lab delta.lab delta.lab delta.lab |
| C6e | nat-1 を leecher にすると delta.lab の頁は見つからない | PASS | (no results) |
| C7a | fork-1 は URL を変えていないのに、ピア間の交換で一覧 v2 を取り込む | PASS | {"lists":[2],"delegations":[{"version":1,"revoked":false}]} |
| C7b | v2 で外した fork-3 の頁（gamma.lab）が出なくなる | PASS | beta.lab beta.lab |
| C8 | 委任を失効させると、そのオペレータの一覧のピアの結果が消え、自ピアの結果だけが残る | PASS | {"lists":[2],"delegations":[{"version":2,"revoked":true}]} (no results) |
