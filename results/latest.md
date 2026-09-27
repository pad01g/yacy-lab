# yacy-lab results

- at: 2026-09-27T03:15:26.995Z
- clusters: upstream, fork; scenarios: default, solr-only, rwi-only, solr-only:mm=1, solr-only:no-coverage, solr-only:mm=1+no-cov, solr-only:mm=100%
- query origin: node 1 of each cluster (crawled alpha.lab only), resource=global

## Summary

| cluster / scenario | subset | R-prec ↑ | recall@10 ↑ | decoy@R ↓ | allTerms@10 ↑ | remote@10 |
|---|---|---:|---:|---:|---:|---:|
| upstream / default | all | 0.79 | 0.98 | 0.21 | 0.43 | 0.89 |
| upstream / default | en | 0.81 | 0.97 | 0.19 | 0.42 | 0.90 |
| upstream / default | cjk | 0.76 | 1.00 | 0.24 | 0.44 | 0.88 |
| fork / default | all | 0.95 | 0.95 | 0.00 | 0.93 | 0.98 |
| fork / default | en | 0.93 | 0.93 | 0.00 | 0.96 | 0.97 |
| fork / default | cjk | 0.96 | 0.96 | 0.00 | 0.90 | 1.00 |
| upstream / solr-only | all | 0.79 | 0.98 | 0.21 | 0.43 | 0.89 |
| upstream / solr-only | en | 0.81 | 0.97 | 0.19 | 0.42 | 0.90 |
| upstream / solr-only | cjk | 0.76 | 1.00 | 0.24 | 0.44 | 0.88 |
| fork / solr-only | all | 1.00 | 1.00 | 0.00 | 0.90 | 0.98 |
| fork / solr-only | en | 1.00 | 1.00 | 0.00 | 0.92 | 0.97 |
| fork / solr-only | cjk | 1.00 | 1.00 | 0.00 | 0.88 | 1.00 |
| upstream / rwi-only | all | 0.02 | 0.02 | 0.00 | 0.09 | 0.00 |
| upstream / rwi-only | en | 0.03 | 0.03 | 0.00 | 0.17 | 0.00 |
| upstream / rwi-only | cjk | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| fork / rwi-only | all | 0.95 | 0.95 | 0.00 | 0.93 | 0.98 |
| fork / rwi-only | en | 0.93 | 0.93 | 0.00 | 0.96 | 0.97 |
| fork / rwi-only | cjk | 0.96 | 0.96 | 0.00 | 0.90 | 1.00 |
| fork / solr-only:mm=1 | all | 0.96 | 1.00 | 0.04 | 0.43 | 0.89 |
| fork / solr-only:mm=1 | en | 0.93 | 1.00 | 0.07 | 0.42 | 0.90 |
| fork / solr-only:mm=1 | cjk | 1.00 | 1.00 | 0.00 | 0.44 | 0.88 |
| fork / solr-only:no-coverage | all | 1.00 | 1.00 | 0.00 | 0.90 | 0.98 |
| fork / solr-only:no-coverage | en | 1.00 | 1.00 | 0.00 | 0.92 | 0.97 |
| fork / solr-only:no-coverage | cjk | 1.00 | 1.00 | 0.00 | 0.88 | 1.00 |
| fork / solr-only:mm=1+no-cov | all | 0.79 | 0.96 | 0.21 | 0.42 | 0.89 |
| fork / solr-only:mm=1+no-cov | en | 0.81 | 0.93 | 0.19 | 0.40 | 0.90 |
| fork / solr-only:mm=1+no-cov | cjk | 0.76 | 1.00 | 0.24 | 0.44 | 0.88 |
| fork / solr-only:mm=100% | all | 0.95 | 0.95 | 0.00 | 0.95 | 0.98 |
| fork / solr-only:mm=100% | en | 0.93 | 0.93 | 0.00 | 1.00 | 0.97 |
| fork / solr-only:mm=100% | cjk | 0.96 | 0.96 | 0.00 | 0.90 | 1.00 |

## Per query (R-prec / decoy@R)

| query | upstream / default | fork / default | upstream / solr-only | fork / solr-only | upstream / rwi-only | fork / rwi-only | fork / solr-only:mm=1 | fork / solr-only:no-coverage | fork / solr-only:mm=1+no-cov | fork / solr-only:mm=100% |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| ERC-4337 bundler | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.20 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 |
| tokio select cancellation safety | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| postgres autovacuum tuning | 0.80 / 0.20 | 0.80 / 0.00 | 0.80 / 0.20 | 1.00 / 0.00 | 0.00 / 0.00 | 0.80 / 0.00 | 0.80 / 0.20 | 1.00 / 0.00 | 0.80 / 0.20 | 0.80 / 0.00 |
| kubernetes pod eviction | 0.80 / 0.20 | 0.80 / 0.00 | 0.80 / 0.20 | 1.00 / 0.00 | 0.00 / 0.00 | 0.80 / 0.00 | 0.80 / 0.20 | 1.00 / 0.00 | 0.80 / 0.20 | 0.80 / 0.00 |
| bitcoin lightning channel | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| solr edismax minimum match | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| 暗号資産交換業 登録 金融庁 | 0.80 / 0.20 | 0.80 / 0.00 | 0.80 / 0.20 | 1.00 / 0.00 | 0.00 / 0.00 | 0.80 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.80 / 0.20 | 0.80 / 0.00 |
| ステーブルコイン 規制 | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| 大阪 万博 | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| 機械学習 入門 | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |
| 区块链 钱包 | 0.75 / 0.25 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 | 0.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 1.00 / 0.00 | 0.75 / 0.25 | 1.00 / 0.00 |

## Top 10 per query

`R` = relevant, `d` = decoy (keyword-stuffed page with one query term), `-` = other

### ERC-4337 bundler

- upstream / default: R R R R R d d d d d
- fork / default: R R R R R
- upstream / solr-only: R R R R R d d d d d
- fork / solr-only: R R R R R
- upstream / rwi-only: R
- fork / rwi-only: R R R R R
- fork / solr-only:mm=1: R R R R R d d d d d
- fork / solr-only:no-coverage: R R R R R
- fork / solr-only:mm=1+no-cov: R R R R R d d d d d
- fork / solr-only:mm=100%: R R R R R

### tokio select cancellation safety

- upstream / default: R d R R d R d d d d
- fork / default: R R R R
- upstream / solr-only: R d R R d R d d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R d R R R d d d d d
- fork / solr-only:mm=100%: R R R R

### postgres autovacuum tuning

- upstream / default: d R R R R R d d d d
- fork / default: R R R R
- upstream / solr-only: R d R R R R d d d d
- fork / solr-only: R R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d R d d d d
- fork / solr-only:no-coverage: R R R R R
- fork / solr-only:mm=1+no-cov: R d R R R d d d d d
- fork / solr-only:mm=100%: R R R R

### kubernetes pod eviction

- upstream / default: R R d R R d d d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d d d
- fork / solr-only: R R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d R d d d d
- fork / solr-only:no-coverage: R R R R R
- fork / solr-only:mm=1+no-cov: R R d R R d d d d d
- fork / solr-only:mm=100%: R R R R

### bitcoin lightning channel

- upstream / default: R d R R R d d d d d
- fork / default: R R R R
- upstream / solr-only: R d R R R d d d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R d R R R d d d d d
- fork / solr-only:mm=100%: R R R R

### solr edismax minimum match

- upstream / default: R R d R R d d d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R R d R R d d d d d
- fork / solr-only:mm=100%: R R R R

### 暗号資産交換業 登録 金融庁

- upstream / default: R d R R R R d d d d
- fork / default: R R R R
- upstream / solr-only: R d R R R R d d d d
- fork / solr-only: R R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R R d d d d d
- fork / solr-only:no-coverage: R R R R R
- fork / solr-only:mm=1+no-cov: R d R R R R d d d d
- fork / solr-only:mm=100%: R R R R

### ステーブルコイン 規制

- upstream / default: R R d R R d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R R d R R d d d
- fork / solr-only:mm=100%: R R R R

### 大阪 万博

- upstream / default: R R d R R d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R R R d R d d d
- fork / solr-only:mm=100%: R R R R

### 機械学習 入門

- upstream / default: R R d R R d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R R d R R d d d
- fork / solr-only:mm=100%: R R R R

### 区块链 钱包

- upstream / default: R R d R R d d d
- fork / default: R R R R
- upstream / solr-only: R R d R R d d d
- fork / solr-only: R R R R
- upstream / rwi-only: (no results)
- fork / rwi-only: R R R R
- fork / solr-only:mm=1: R R R R d d d d
- fork / solr-only:no-coverage: R R R R
- fork / solr-only:mm=1+no-cov: R R d R R d d d
- fork / solr-only:mm=100%: R R R R

