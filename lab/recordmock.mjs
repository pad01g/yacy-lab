// モック用に、動いているデモ（compose.demo.yaml）の本物の応答を記録して lab/demo/mock-data.json に書く。
//   docker run --rm --network yacydemo_pub -v "$PWD/lab/demo:/out" -v "$PWD/lab/recordmock.mjs:/recordmock.mjs:ro" node:24-alpine node /recordmock.mjs
// 問い合わせ元 fork-1 の信頼の設定を切り替えて記録し、最後に「A だけ」に戻す（15 分ほど）。
const B = "http://demo:8800";
const H = { host: "demo:8800", origin: "http://demo:8800", "content-type": "application/json" };
const get = async (p) => (await fetch(B + p, { headers: { host: "demo:8800" } })).json();
const post = async (p, body) => {
  const r = await fetch(B + p, { method: "POST", headers: H, body: JSON.stringify(body) });
  return r.text();
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = await get("/api/state");
const trust = await get("/api/trust");
const presets = state.presets;
async function search(side, q, extra = {}) {
  const txt = await post("/api/search", { side, q, origin: side === "fork" ? "fork-1" : "up-1", open: "1", noads: "0", wait: "5000", ...extra });
  const lines = txt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const p1 = lines.find((l) => l.pass === 1), p2 = lines.find((l) => l.pass === 2);
  if (!p2) throw new Error(`${side} ${q}: ${txt.slice(0, 200)}`);
  return { pass1: { ms: p1?.ms ?? 0, hits: p1?.hits ?? [] }, final: { ms: p2.ms, hits: p2.hits } };
}
const out = { recordedAt: new Date().toISOString(), state, trust, presets, upstream: {}, fork: {}, pages: {} };
for (const p of presets) out.upstream[p.q] = await search("upstream", p.q), console.log("up", p.q);
const MODES = { A: { coordinators: ["A"], fallback: "self" }, AB: { coordinators: ["A", "B"], fallback: "self" }, signedOnly: { coordinators: [], fallback: "signedOnly" } };
for (const [name, mode] of Object.entries(MODES)) {
  console.log("mode", name, await post("/api/trust/mode", { node: "fork-1", ...mode }).then((t) => t.slice(0, 60)));
  await sleep(60000);
  out.fork[name] = {};
  for (const p of presets) out.fork[name][p.q] = await search("fork", p.q), console.log(name, p.q, out.fork[name][p.q].final.hits.length);
}
await post("/api/trust/mode", { node: "fork-1", ...MODES.A });
const urls = new Set();
for (const side of [out.upstream, ...Object.values(out.fork)]) for (const r of Object.values(side)) for (const h of [...r.pass1.hits, ...r.final.hits]) urls.add(h.url);
for (const u of urls) {
  const html = await (await fetch(B + "/page?url=" + encodeURIComponent(u), { headers: { host: "demo:8800" } })).text();
  const title = (html.match(/<title>([^<]*)<\/title>/i) || [])[1] || "";
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().slice(0, 2500);
  out.pages[u] = { title, text };
}
const fs = await import("node:fs");
fs.writeFileSync("/out/mock-data.json", JSON.stringify(out));
console.log("done", presets.length, "queries", urls.size, "pages", fs.statSync("/out/mock-data.json").size, "bytes");
