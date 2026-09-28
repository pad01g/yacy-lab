# Agents

- To **use** a YaCy search engine from an agent (start a peer, crawl, search, tune and evaluate ranking), read
  [skills/yacy-p2p-search/SKILL.md](skills/yacy-p2p-search/SKILL.md). Install it with `npx skills add pad01g/yacy-lab`.
- To **measure** search quality or trust behaviour reproducibly, run the experiments in this repository (see README):
  `docker compose -p yacylab up -d && docker compose -p yacylab run --rm runner` writes `results/<time>.md`.
  The corpus, queries and relevant URLs are generated deterministically in `lab/corpus.ts`; add queries there to test
  a new ranking idea, and compare scenarios in `lab/run.ts`.
- The YaCy fork itself and its MCP server: https://github.com/pad01g/yacy_search_server (branch `improved-search`, `mcp/`).
- Code style: TypeScript run directly by Node 24 (type stripping, no build step), no runtime dependencies in `lab/`.
  Type-check with `tsc --noEmit --strict --module nodenext --allowImportingTsExtensions --erasableSyntaxOnly`.
