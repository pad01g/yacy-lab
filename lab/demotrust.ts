// デモの信頼の設定（demo.ts から使う）。コーディネータ 2 つの鍵と一覧を持ち、画面からの変更を署名して配る。
//   A: デモの運営者。一覧を画面で編集できる（信頼する / しない、優先度、タグ）。委任の失効・復活もできる
//   B: 別の運営者。一覧は evil-1 だけ。問い合わせ元が B も信頼すると、evil-1 の文書が「検証済み」になる
// 鍵と状態は DEMO_STATE（既定 /state/trust.json、compose の volume）に保存し、デモを再起動しても同じ鍵を使う。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ALL, delegation, keyFromPem, keyToPem, LAB, log, newKey, peerList, putFile, type Key, type Member } from "./trustlib.ts";
import { base, setConfig } from "./yacy.ts";

const FILE = process.env.DEMO_STATE ?? "/state/trust.json";

export type Entry = { trusted: boolean; priority: number; tags: string[] };
export type Mode = { coordinators: ("A" | "B")[]; fallback: "self" | "signedOnly" };
type Pair = { coordinator: Key; operator: Key };
type State = {
  keys: { A: Pair; B: Pair };
  delegation: { version: number; revoked: boolean };
  list: { version: number; entries: Record<string, Entry> };
  bList: { version: number };
  seq: number;
  modes: Record<string, Mode>;
};

const DEFAULT_ENTRIES: Record<string, Entry> = {
  "fork-1": { trusted: true, priority: 100, tags: [] },
  "fork-2": { trusted: true, priority: 100, tags: [] },
  "fork-3": { trusted: true, priority: 100, tags: [] },
  "nat-1": { trusted: true, priority: 100, tags: [] },
  "ads-1": { trusted: true, priority: 80, tags: ["ads"] },
  "evil-1": { trusted: false, priority: 50, tags: [] },
};
const DEFAULT_MODE: Mode = { coordinators: ["A"], fallback: "self" };

let state: State | null = null;
let pks: Record<string, string> = {};

function save(): void {
  if (!state) return;
  mkdirSync(dirname(FILE), { recursive: true });
  const pair = (p: Pair) => ({ coordinator: keyToPem(p.coordinator), operator: keyToPem(p.operator) });
  writeFileSync(FILE, JSON.stringify({ ...state, keys: { A: pair(state.keys.A), B: pair(state.keys.B) } }, null, 1), { mode: 0o600 });
}

function load(): State | null {
  if (!existsSync(FILE)) return null;
  try {
    const raw = JSON.parse(readFileSync(FILE, "utf8"));
    const pair = (p: { coordinator: string; operator: string }): Pair => ({ coordinator: keyFromPem(p.coordinator), operator: keyFromPem(p.operator) });
    return { ...raw, keys: { A: pair(raw.keys.A), B: pair(raw.keys.B) } };
  } catch (e) {
    log("cannot read", FILE, (e as Error).message);
    return null;
  }
}

const TAG = /^[a-z0-9][a-z0-9._:-]{0,31}$/;
function cleanEntry(e: Partial<Entry> | undefined, fallback: Entry): Entry {
  const priority = Math.max(0, Math.min(100, Math.round(Number(e?.priority ?? fallback.priority))));
  const tags = (Array.isArray(e?.tags) ? e!.tags : fallback.tags).map((t) => String(t).trim().toLowerCase()).filter((t) => TAG.test(t)).slice(0, 8);
  return { trusted: e?.trusted === undefined ? fallback.trusted : e.trusted === true, priority: Number.isFinite(priority) ? priority : fallback.priority, tags };
}

function members(): Member[] {
  if (!state) return [];
  return Object.entries(state.list.entries)
    .filter(([node, e]) => e.trusted && pks[node])
    .map(([node, e]) => ({ pk: pks[node], priority: e.priority, tags: e.tags }));
}

/** sign the current state and hand it to the target nodes under a new URL (a changed URL is fetched at once) */
async function publish(targets: string[]): Promise<void> {
  if (!state) throw new Error("trust state not initialized");
  const s = state;
  s.seq++;
  const envelopes = [
    delegation(s.keys.A.coordinator, s.keys.A.operator, s.delegation.version, s.delegation.revoked),
    peerList(s.keys.A.operator, s.list.version, members()),
    delegation(s.keys.B.coordinator, s.keys.B.operator, 1),
    peerList(s.keys.B.operator, s.bList.version, pks["evil-1"] ? [{ pk: pks["evil-1"], priority: 50, tags: [] }] : []),
  ];
  const name = `demo-bundle-${s.seq}.json`;
  await putFile(name, JSON.stringify({ envelopes }));
  save();
  for (const n of targets) await setConfig(n, "trust.bundle.urls", `${LAB}/files/${name}`);
  log("published", name, "to", targets.join(","));
}

async function applyMode(node: string): Promise<void> {
  if (!state) throw new Error("trust state not initialized");
  const m = state.modes[node] ?? DEFAULT_MODE;
  await setConfig(node, "trust.coordinators", m.coordinators.map((c) => state!.keys[c].coordinator.pk).join(","));
  await setConfig(node, "trust.signedOnly", m.fallback === "signedOnly" ? "true" : "false");
}

/** called once the peers are up: load or create the keys, configure every node and distribute the lists */
export async function initTrust(peerKeys: Record<string, string>): Promise<void> {
  pks = peerKeys;
  state = load();
  if (!state) {
    state = {
      keys: { A: { coordinator: newKey(), operator: newKey() }, B: { coordinator: newKey(), operator: newKey() } },
      delegation: { version: 1, revoked: false },
      list: { version: 1, entries: structuredClone(DEFAULT_ENTRIES) },
      bList: { version: 1 },
      seq: 0,
      modes: {},
    };
    save();
  }
  for (const n of ALL) await applyMode(n);
  await publish(ALL);
}

export function trustReady(): boolean {
  return state !== null;
}

/** coordinator A publishes a new version of its list */
export async function publishList(entries: Record<string, Partial<Entry>>, onlyForkTwo: boolean): Promise<void> {
  if (!state) throw new Error("準備中です");
  for (const node of Object.keys(DEFAULT_ENTRIES)) state.list.entries[node] = cleanEntry(entries[node], state.list.entries[node] ?? DEFAULT_ENTRIES[node]);
  state.list.version++;
  await publish(onlyForkTwo ? ["fork-2"] : ALL);
}

/** coordinator A revokes or restores its delegation to the operator (a newer version wins) */
export async function setDelegation(revoked: boolean, onlyForkTwo: boolean): Promise<void> {
  if (!state) throw new Error("準備中です");
  state.delegation = { version: state.delegation.version + 1, revoked };
  // after a restore the list must be sent again: lists that arrived while the operator was revoked were refused
  if (!revoked) state.list.version++;
  await publish(onlyForkTwo ? ["fork-2"] : ALL);
}

/** which coordinators a node trusts; the node gets the lists again, because it only stored those of its coordinators */
export async function setMode(node: string, mode: Partial<Mode>): Promise<void> {
  if (!state) throw new Error("準備中です");
  if (!ALL.includes(node)) throw new Error(`unknown node ${node}`);
  const coords = (Array.isArray(mode.coordinators) ? mode.coordinators : []).filter((c): c is "A" | "B" => c === "A" || c === "B");
  state.modes[node] = { coordinators: [...new Set(coords)], fallback: mode.fallback === "signedOnly" ? "signedOnly" : "self" };
  await applyMode(node);
  await publish([node]);
}

type Held = { coordinator: "A" | "B" | "?"; kind: "delegation" | "list"; version: number; revoked: boolean };

/** the envelopes a node holds, as published at /yacy/trust.json */
export async function held(node: string): Promise<Held[]> {
  const json = (await (await fetch(`${base(node)}/yacy/trust.json`, { signal: AbortSignal.timeout(3000) })).json()) as { envelopes: { payload: string; signer: string }[] };
  return json.envelopes.map((e) => {
    const p = JSON.parse(Buffer.from(e.payload, "base64url").toString("utf8")) as { type: string; version: number; revoked?: boolean };
    const who = (k: string): "A" | "B" | "?" =>
      !state ? "?" : k === state.keys.A.coordinator.pk || k === state.keys.A.operator.pk ? "A" : k === state.keys.B.coordinator.pk || k === state.keys.B.operator.pk ? "B" : "?";
    return { coordinator: who(e.signer), kind: p.type === "yacy-peerlist-v1" ? "list" : "delegation", version: p.version, revoked: p.revoked === true };
  });
}

/** the state the page shows */
export function view(): object {
  if (!state) return { ready: false };
  const short = (k: Key): string => `${k.pk.slice(0, 10)}…`;
  return {
    ready: true,
    A: { coordinator: short(state.keys.A.coordinator), operator: short(state.keys.A.operator), delegation: state.delegation, list: state.list },
    B: { coordinator: short(state.keys.B.coordinator), operator: short(state.keys.B.operator), list: { version: state.bList.version, peers: ["evil-1"] } },
    modes: Object.fromEntries(ALL.map((n) => [n, state!.modes[n] ?? DEFAULT_MODE])),
  };
}
