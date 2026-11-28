// 悉尼吃喝 AI 美食顾问: Supabase Edge Function "ask"
// Deploy in Supabase: Edge Functions > Deploy a new function > Via Editor, name it "ask",
// paste this file, then turn OFF "Enforce JWT verification" for the function.
// Secrets (Edge Functions > Secrets): ANTHROPIC_API_KEY (required).
// Optional: MODEL_PICK, MODEL_ANSWER, DAY_CAP, IP_CAP, DATA_URL.

const DATA_URL = Deno.env.get("DATA_URL") ?? "https://ian233.com/eat/data.json";
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const API_URL = Deno.env.get("ANTHROPIC_URL") ?? "https://api.anthropic.com/v1/messages";
const MODEL_PICK = Deno.env.get("MODEL_PICK") ?? "claude-haiku-5-5";
const MODEL_ANSWER = Deno.env.get("MODEL_ANSWER") ?? "claude-haiku-5-5";
// Haiku 5.5 thinks by default; this task does not need it, and thinking adds seconds
const EFFORT = Deno.env.get("EFFORT") ?? "low";
const THINKING = Deno.env.get("THINKING") ?? "disabled";
const DAY_CAP = Number(Deno.env.get("DAY_CAP") ?? 400);
const IP_CAP = Number(Deno.env.get("IP_CAP") ?? 40);
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "https://hmipkgllqnyvabcntipb.supabase.co";
const SB_KEY = "sb_publishable_9tEEaEglzcirAP7ZRu3DCQ_Weczqod8"; // public key, only used for the ai_gate RPC
const ORIGINS = ["https://ian233.com", "https://www.ian233.com", "http://localhost:8765"];

type R = { id: number; n: string; ne?: string; a: string; t: string; r: string; p?: number; pe?: number; d?: string; i?: string; dt?: string; c?: string; xy?: [number, number] };
type Turn = { q: string; say?: string; ids?: number[] };

let DATA: R[] = [];
let BY_ID = new Map<number, R>();
let loadedAt = 0;

async function data(): Promise<R[]> {
  if (!DATA.length || Date.now() - loadedAt > 3600_000) {
    const r = await fetch(DATA_URL, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error("data " + r.status);
    DATA = await r.json();
    BY_ID = new Map(DATA.map((d) => [d.id, d]));
    loadedAt = Date.now();
  }
  return DATA;
}

// map coordinates on the site's sketch map back to lat/lon
const toLL = (xy: [number, number]) => ({ lon: xy[0] * 0.38 / 1000 + 150.93, lat: -33.69 - xy[1] * 0.36 / 1140.7 });
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const stars = (r: string) => (r === "X" ? "不推荐" : r + "星");
const short = (s = "", n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// the catalogue never changes between questions, so it stays in the prompt cache
let CAT = "", CAT_AT = 0;
function catalogue(rows: R[]) {
  if (CAT_AT !== loadedAt) {
    CAT = rows.map((d) => `${d.id}|${d.n}|${d.a}|${d.t}|${stars(d.r)}|$${d.p ?? "?"}${d.pe ? "估" : ""}|${short(d.d, 28)}`).join("\n");
    CAT_AT = loadedAt;
  }
  return CAT;
}
// with a location, list the 40 nearest places in the question instead of changing the cached catalogue
function nearest(rows: R[], here: { lat: number; lon: number }) {
  return rows.filter((d) => d.xy && d.r !== "X").map((d) => ({ id: d.id, k: km(here, toLL(d.xy!)) }))
    .sort((a, b) => a.k - b.k).slice(0, 40).map((x) => `${x.id}:${x.k.toFixed(1)}km`).join(" ");
}

async function claude(model: string, system: unknown, messages: unknown[], max: number) {
  const r = await fetch(API_URL, {
    method: "POST",
    headers: { "x-api-key": API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model, max_tokens: max, system, messages, thinking: { type: THINKING }, output_config: { effort: EFFORT } }),
  });
  if (!r.ok) throw new Error("claude " + r.status + " " + (await r.text()).slice(0, 300));
  const j = await r.json();
  const text = (j.content ?? []).filter((c: { type?: string }) => c.type === "text").map((c: { text?: string }) => c.text ?? "").join("");
  if (j.stop_reason && j.stop_reason !== "end_turn") console.warn("stop_reason", j.stop_reason, JSON.stringify(j.usage ?? {}));
  return text;
}
// ask, and if the reply has no parsable JSON, ask once more saying so
async function claudeJSON(model: string, system: unknown, messages: { role: string; content: string }[], max: number) {
  let text = await claude(model, system, messages, max);
  try { return json(text); } catch { console.error("not json, retrying:", text.slice(0, 600)); }
  text = await claude(model, system, [...messages, { role: "assistant", content: text.slice(0, 2000) || "…" }, { role: "user", content: "请只输出一个 JSON 对象，不要任何其他文字。" }], max);
  try { return json(text); } catch { console.error("still not json:", text.slice(0, 600)); return { _raw: text }; }
}
function json(text: string) {
  const t = text.replace(/```(?:json)?/g, "");
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("no json");
  return JSON.parse(t.slice(a, b + 1));
}

function history(turns: Turn[]) {
  const m: { role: string; content: string }[] = [];
  for (const t of turns.slice(-3)) {
    m.push({ role: "user", content: short(t.q, 300) });
    const names = (t.ids ?? []).map((i) => BY_ID.get(i)?.n).filter(Boolean).join("、");
    m.push({ role: "assistant", content: (t.say ?? "") + (names ? ` 推荐了：${names}` : "") || "好的" });
  }
  return m;
}

async function gate(ip: string, q: string) {
  // counts and logs in one call; returns ok | ip | day. If the table is missing, let it through.
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/ai_gate`, {
      method: "POST",
      headers: { apikey: SB_KEY, "content-type": "application/json" },
      body: JSON.stringify({ p_ip: ip, p_q: q, p_ip_cap: IP_CAP, p_day_cap: DAY_CAP }),
    });
    if (!r.ok) return "ok";
    return await r.json();
  } catch { return "ok"; }
}
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s + "eat"));
  return Array.from(new Uint8Array(b)).slice(0, 8).map((x) => x.toString(16).padStart(2, "0")).join("");
}

const PICK_SYS = `你是悉尼餐厅检索器。下面是全部餐厅目录，每行格式：id|店名|区域|菜系|星级|人均|招牌菜。用户开了定位时，问题后面会附上离他最近的店和距离。
根据用户最新的需求（结合之前的对话），从目录中选出最多 8 家最可能符合的候选，按匹配度排序。
规则：只能选目录里存在的 id；默认不选"不推荐"的店，除非用户在问哪些店别去；附上了最近的店且用户提到附近、近一点时，优先从那里面选；尽量照顾区域、人均、菜系、场合这些条件。
只输出 JSON：{"ids":[整数...],"need":"一句话概括用户需求"}`;

const ANSWER_SYS = `你是「悉尼吃喝」网站的 AI 美食顾问。网站的所有点评都是站长老杨自己去吃过后写的，你的判断只能依据这些点评，不要编造点评里没有的信息（例如营业时间、价格以外的细节）。
从候选里挑 1 到 3 家最合适的店回答用户。每家给出：
why：为什么适合这个需求，具体一点，两句话以内；
quote：从这家店的点评原文里一字不改地摘一句最能说服人的话，不超过 30 个字，必须是原文连续的一段；
tip：点什么或要注意什么，一句话，可以为空。
如果候选都不太合适，诚实说明，并建议怎么放宽条件。
语气像一个懂吃的朋友，简洁，不用感叹号堆砌，不要使用破折号。回答语言按消息末尾的要求。
只输出 JSON：{"say":"一两句开场","picks":[{"id":整数,"why":"","quote":"","tip":""}],"follow":["可以接着问的两个短问题"]}`;

function cors(origin: string | null) {
  const o = origin && ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return { "access-control-allow-origin": o, "access-control-allow-headers": "authorization, x-client-info, apikey, content-type", "access-control-allow-methods": "POST, OPTIONS", vary: "origin" };
}

export async function handle(req: Request): Promise<Response> {
  const origin = req.headers.get("origin");
  const h = { ...cors(origin), "content-type": "application/json; charset=utf-8" };
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  const out = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: h });
  if (req.method !== "POST") return out({ error: "method" }, 405);
  if (origin && !ORIGINS.includes(origin)) return out({ error: "origin" }, 403);
  if (!API_KEY) return out({ error: "no_key" }, 503);
  let body: { q?: string; turns?: Turn[]; lat?: number; lon?: number };
  try { body = await req.json(); } catch { return out({ error: "bad_json" }, 400); }
  const q = String(body.q ?? "").trim().slice(0, 300);
  if (!q) return out({ error: "empty" }, 400);
  const ip = await sha(req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "?");
  const g = await gate(ip, q);
  if (g === "ip") return out({ error: "limit_ip" }, 429);
  if (g === "day") return out({ error: "limit_day" }, 429);
  const t0 = Date.now();
  try {
    const rows = await data();
    const here = typeof body.lat === "number" && typeof body.lon === "number" ? { lat: body.lat, lon: body.lon } : undefined;
    const turns = Array.isArray(body.turns) ? body.turns : [];
    // step 1: pick candidates from the whole catalogue (cached prompt when there is no location)
    const sys1 = [{ type: "text", text: PICK_SYS }, { type: "text", text: catalogue(rows), cache_control: { type: "ephemeral" } }];
    const q1 = here ? `${q}\n\n（离我最近的店，id:距离）${nearest(rows, here)}` : q;
    const t1 = Date.now();
    const p1 = await claudeJSON(MODEL_PICK, sys1, [...history(turns), { role: "user", content: q1 }], 800);
    // if the reply was not JSON, take any known ids that appear in it
    const raw1: number[] = p1.ids ?? (String(p1._raw ?? "").match(/\d+/g) ?? []);
    const ids: number[] = [...new Set(raw1.map(Number))].filter((i: number) => BY_ID.has(i)).slice(0, 8);
    if (!ids.length) return out({ say: "没在点评里找到合适的店。换个说法，或者把区域、人均放宽一点试试？", picks: [], follow: [], ms: Date.now() - t0 });
    // step 2: full reviews of the candidates, choose and explain
    const cand = ids.map((i) => BY_ID.get(i)!).map((d) => {
      const dist = here && d.xy ? ` 距离${km(here, toLL(d.xy)).toFixed(1)}km` : "";
      return `[${d.id}] ${d.n}${d.ne && d.ne !== d.n ? ` (${d.ne})` : ""}｜${d.a}｜${d.t}｜${stars(d.r)}｜人均$${d.p ?? "?"}${d.pe ? "(估)" : ""}${dist}\n招牌：${d.d ?? ""}\n点评：${d.i ?? ""}`;
    }).join("\n\n");
    const zh = /[\u4e00-\u9fff]/.test(q);
    const msg = `用户需求：${q}\n（概括：${p1.need ?? ""}）\n\n候选餐厅：\n${cand}\n\n${zh ? "请用中文回答（say、why、tip、follow 都用中文）。" : "Answer in English (say, why, tip, follow in English; keep quote in the original Chinese)."}`;
    const t2 = Date.now();
    let p2 = await claudeJSON(MODEL_ANSWER, ANSWER_SYS, [...history(turns), { role: "user", content: msg }], 2000);
    // last resort: show the top candidates with the opening of each review
    if (p2._raw !== undefined) p2 = { say: "按你的条件，这几家最接近：", picks: ids.slice(0, 3).map((i) => ({ id: i, why: short(BY_ID.get(i)?.i, 60), quote: "", tip: "" })), follow: [] };
    const picks = (p2.picks ?? []).filter((p: { id: number }) => ids.includes(Number(p.id))).slice(0, 3).map((p: { id: number; why?: string; quote?: string; tip?: string }) => {
      const d = BY_ID.get(Number(p.id))!;
      const quote = p.quote && d.i && d.i.includes(String(p.quote).replace(/[「」“”"]/g, "")) ? String(p.quote).replace(/[「」“”"]/g, "") : "";
      return { id: d.id, why: String(p.why ?? ""), quote, tip: String(p.tip ?? ""), km: here && d.xy ? Number(km(here, toLL(d.xy)).toFixed(1)) : undefined };
    });
    return out({ say: String(p2.say ?? ""), picks, follow: (p2.follow ?? []).slice(0, 2).map(String), ms: Date.now() - t0, ms_pick: t2 - t1 });
  } catch (e) {
    console.error(e);
    return out({ error: "ai_failed" }, 502);
  }
}

Deno.serve(handle);
