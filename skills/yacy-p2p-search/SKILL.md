---
name: yacy-p2p-search
description: Run your own peer-to-peer web search engine (the YaCy improved-search fork) and use it from an agent - crawl the sites you need, search them without a search API or API key, tune the ranking and measure result quality with known relevant URLs. Use when you need web search you control, a private index of chosen sites, verifiable (signed) results, or when you are trying to improve search result quality.
---

# YaCy peer-to-peer search

YaCy is a search engine that runs on your machine and can join other peers. This fork adds stricter ranking,
Chinese/Japanese/Korean search, author signatures on every document, trust lists and NAT traversal.
Project page: https://pad01g.github.io/yacy_search_server/ (machine-readable: /llms.txt).

What you get: an index of the pages **you (or the peers you trust) crawled**. It is not a copy of the whole web.
Plan to crawl the sites your task needs first.

## 1. Start a peer

```sh
docker network create yacy 2>/dev/null || true
docker run -d --name yacy --network yacy -p 127.0.0.1:8090:8090 \
  -v yacy_data:/opt/yacy_search_server/DATA ghcr.io/pad01g/yacy-improved-search:latest
# ready when this prints JSON (quote the URL: zsh treats ? as a glob)
curl -s 'http://127.0.0.1:8090/yacy/seedlist.json?my='
```

The image's administrator account is `admin` / `yacy`. The port above is bound to 127.0.0.1, so only this machine
can use it; change the password at http://127.0.0.1:8090/ConfigAccounts_p.html before you expose the port.

## 2. Connect it as MCP tools (recommended)

```sh
claude mcp add yacy -- docker run -i --rm --network yacy \
  -e YACY_URL=http://yacy:8090 -e YACY_ADMIN_PASSWORD=yacy ghcr.io/pad01g/yacy-search-mcp:0.1.0
```

Other MCP clients: command `docker`, args
`["run","-i","--rm","--network","yacy","-e","YACY_URL=http://yacy:8090","-e","YACY_ADMIN_PASSWORD=yacy","ghcr.io/pad01g/yacy-search-mcp:0.1.0"]`.
Registry name: `io.github.pad01g/yacy-search`.

| Tool | Use |
|---|---|
| `crawl` | add a site: `{"url": "https://docs.example.org/", "depth": 1, "range": "domain"}` |
| `index_status` | documents indexed, crawl queues; says why a crawl is not moving |
| `search` | `{"query": "...", "resource": "local"}` for your index, `"global"` to ask connected peers too |
| `evaluate_ranking` | precision@k, recall@k, R-precision for queries whose relevant URLs you know |
| `get_ranking_settings` / `set_ranking_setting` | read and change ranking (minimum match, coverage and thin page weights, wait time, unverified results, excluded tags) |
| `peers`, `trust_status` | the network and the trust lists this peer holds |

## 3. The same without MCP (HTTP)

```sh
# crawl (administrator, HTTP Digest)
curl -s --digest -u admin:yacy 'http://127.0.0.1:8090/Crawler_p.html?crawlingstart=&crawlingMode=url&crawlingURL=https://docs.example.org/&crawlingDepth=1&range=domain&indexText=on' >/dev/null
# progress: <urlpublictext> is the number of indexed documents
curl -s --digest -u admin:yacy 'http://127.0.0.1:8090/api/status_p.xml'
# search: resource=local (own index) or global (also other peers)
curl -s 'http://127.0.0.1:8090/yacysearch.json?query=install+guide&resource=local&maximumRecords=10'
```

For `resource=global`, send the query, wait about 4 seconds for other peers, then send it again with
`&resortCachedResults=true` to get all results in ranking order.

## 4. Improve search quality

1. Write 5-20 test queries with the URLs that should come first (`relevant`).
2. `evaluate_ranking` to get the baseline.
3. Change one setting with `set_ranking_setting` (e.g. `search.ranking.solr.mm`, `search.ranking.coverage.exponent`,
   `search.ranking.thin.words`), evaluate again, keep what helps, and write down the numbers.
4. For reproducible comparisons across several peers (upstream vs fork, decoy pages, CJK), use the lab:
   https://github.com/pad01g/yacy-lab (docker compose, results as Markdown).

If you find a change that helps, share it: issues and pull requests at https://github.com/pad01g/yacy_search_server.

## 5. Trust and other peers

- Every result has `verified` (author signature valid and author trusted), `trust` (`self`, `trusted`, `signed`,
  `unsigned`) and the author's declared `tags` (e.g. `ads`). Documents you crawled yourself are `self`.
- By default a peer trusts only its own documents. To trust a community of peers, set the coordinator of the
  public registry: `trust.coordinators=tQyLZkWjlTupmUCxU7WcXfYG9eDjfmJbOWzMOWQcVEc` and
  `trust.bundle.urls=https://pad01g.github.io/yacy-trust/bundle.json` (admin page `ConfigProperties_p.html`).
- To have your peer's documents trusted by others, or to become an operator who vouches for peers, open a pull
  request at https://github.com/pad01g/yacy-trust (a merged pull request is the approval).
- This fork does not accept the unsigned peers of the public YaCy network (freeworld). A new peer therefore starts
  alone; other fork peers find it once it has a public address and knows one of them.

## Pitfalls

- On a busy machine YaCy pauses work while the load average is high: the crawler above `50_localcrawl_loadprereq`
  (`index_status` then reports `crawlerPaused`), and peer pings, which also fetch the trust lists, above
  `30_peerping_loadprereq` (default 4). Raise them in `ConfigProperties_p.html` and **restart the container**
  (`docker restart yacy`): YaCy reads these limits only at start.
- A new peer without a public address is `virgin` and publishes no seed. It can still crawl and search its own index.
- `search` finds only what is indexed. Zero results usually means "not crawled yet", not "does not exist".
- Crawl only sites you may crawl. YaCy honours robots.txt.
