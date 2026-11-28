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
const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const PLACE_FN = Deno.env.get("PLACE_FN") ?? `${SB_URL}/functions/v1/place`;
const SB_KEY = "sb_publishable_9tEEaEglzcirAP7ZRu3DCQ_Weczqod8"; // public key, only used for the ai_gate RPC
const ORIGINS = ["https://ian233.com", "https://www.ian233.com", "http://localhost:8765"];

type R = { id: number; n: string; ne?: string; a: string; rg?: string; t: string; r: string; p?: number; pe?: number; d?: string; i?: string; dt?: string; c?: string; xy?: [number, number] };
type Turn = { q: string; say?: string; ids?: number[] };

let DATA: R[] = [];
let BY_ID = new Map<number, R>();
let loadedAt = 0;

export async function data(): Promise<R[]> {
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
// real coordinates from the place_map table (Google, refreshed monthly); the sketch map position otherwise
let REAL = new Map<number, { lat: number; lon: number }>(), realAt = 0;
async function loadReal() {
  if (!SB_SVC || Date.now() - realAt < 3600_000) return;
  realAt = Date.now();
  try {
    const r = await fetch(`${SB_URL}/rest/v1/place_map?select=rid,lat,lon&lat=not.is.null`, { headers: { apikey: SB_SVC, authorization: "Bearer " + SB_SVC } });
    if (r.ok) REAL = new Map((await r.json()).map((x: { rid: number; lat: number; lon: number }) => [x.rid, { lat: x.lat, lon: x.lon }]));
  } catch { /* keep the sketch positions */ }
}
const pos = (d: R) => REAL.get(d.id) ?? toLL(d.xy!);
// opening hours from the place function (stored Google hours); empty when it is not set up
async function hours(ids: number[]): Promise<Record<number, { open: boolean | null; line: string }>> {
  if (!ids.length) return {};
  try {
    const r = await fetch(PLACE_FN, { method: "POST", headers: { "content-type": "application/json", origin: "https://ian233.com" }, body: JSON.stringify({ op: "info", ids }), signal: AbortSignal.timeout(4000) });
    return r.ok ? await r.json() : {};
  } catch { return {}; }
}
const NOW = /现在|今晚|宵夜|夜宵|马上|一会|还开|还在营业|开着|附近|nearby|now|tonight/i;
const LATER = /明天|周末|下次|改天|下周|明早|明晚|tomorrow|weekend/i;
function lateNow() { const h = Number(new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Sydney", hour: "numeric", hourCycle: "h23" }).format(new Date())); return h >= 20 || h < 6; }

const stars = (r: string) => (r === "X" ? "不推荐" : r + "星");
const short = (s = "", n: number) => (s.length > n ? s.slice(0, n) + "…" : s);

// the catalogue never changes between questions, so it stays in the prompt cache
let CAT = "", CAT_AT = 0;
function catalogue(rows: R[]) {
  if (CAT_AT !== loadedAt) {
    CAT = rows.map((d) => `${d.id}|${d.n}|${d.rg ?? ""}|${d.a}|${d.t}|${stars(d.r)}|$${d.p ?? "?"}${d.pe ? "估" : ""}|${short(d.d, 28)}`).join("\n");
    CAT_AT = loadedAt;
  }
  return CAT;
}
// with a location, list the 40 nearest places in the question instead of changing the cached catalogue
function nearest(rows: R[], here: { lat: number; lon: number }) {
  return rows.filter((d) => d.xy && d.r !== "X").map((d) => ({ id: d.id, k: km(here, pos(d)) }))
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

const REGION_WORDS: [string, RegExp][] = [
  ["内西", /内西|inner\s*west/i], ["北岸", /北岸|north\s*shore/i], ["东区", /东区|eastern\s*suburbs/i],
  ["城南", /城南|inner\s*south/i], ["山区", /山区|the\s*hills|hills\s*district/i], ["南区", /南区|south\s*sydney|southern\s*sydney/i],
  ["西区", /西区|western\s*sydney/i], ["北区", /北区/], ["市区", /市区|市中心|\bcbd\b|city\s*centre/i],
];
function regionOf(q: string) { return REGION_WORDS.find(([, re]) => re.test(q))?.[0]; }

function fallbackIds(rows: R[], q: string, want?: string) {
  const pool = rows.filter((d) => d.r !== "X" && (!want || d.rg === want));
  const words: string[] = ([...(q.toLowerCase().match(/[a-z]{3,}/g) ?? [])] as string[]).concat([...q.replace(/[^\u4e00-\u9fff]/g, "")].map((c, i, a) => c + (a[i + 1] ?? "")).filter((w) => w.length === 2));
  const stop = new Set(["附近", "什么", "好吃", "吃的", "有什", "么好", "想吃", "一点", "不想", "吃什", "下雨", "雨不", "想走", "走远", "不那", "那么"]);
  const ws = words.filter((w) => !stop.has(w));
  const score = (d: R) => { const t = `${d.n} ${d.ne ?? ""} ${d.a} ${d.rg ?? ""} ${d.t} ${d.d ?? ""} ${d.i ?? ""}`.toLowerCase(); return ws.reduce((s, w) => s + (t.includes(w) ? 1 : 0), 0); };
  const hit = pool.map((d) => ({ d, s: score(d) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s || (b.d.r > a.d.r ? 1 : -1)).slice(0, 8).map((x) => x.d.id);
  if (hit.length) return hit;
  return pool.filter((d) => d.r === "5" || d.r === "4").sort(() => Math.random() - 0.5).slice(0, 8).map((d) => d.id);
}

// cuisine family of a place's type label, so "中餐" never returns Japanese BBQ
const FAM_CN = /中餐|中式|中西|粤|川|湘|潮|港式|台式|台湾|东北|上海|本帮|江浙|北京|山东|云南|贵州|新疆|兰州|西北|陕西|重庆|自贡|福建|泉州|南京|长沙|江西|延边|沧州|烧腊|早茶|点心|小笼|生煎|饺|馄饨|包子|麻辣|冒菜|火锅|炸串|糖水|鸭货|卤味|肠粉|砂锅|米线|小炒|家常|茶餐厅|酒楼|大排档|广东汤|盐焗鸡|牛肉面|手工面|拌面|木桶鱼|石锅鱼|红烧|锅贴|小面|面馆|烤串|米粉|羊肉粉|中式|茶馆/;
export function famOfType(t: string) {
  if (/中东|土耳其|黎巴嫩|波斯/.test(t)) return "其他";
  if (/韩|釜山/.test(t)) return "韩餐";
  if (/日式|日料|日本/.test(t)) return "日料";
  if (FAM_CN.test(t)) return "中餐";
  if (/寿司|Omakase|居酒屋|铁板烧|饭团|刺身|丼|抹茶|寿喜烧|蕨饼|大福/i.test(t)) return "日料";
  if (/越南|泰|马来|印尼|菲律宾|南洋|东南亚/.test(t)) return "东南亚";
  if (/咖啡|Cafe|烘焙|蛋糕|甜品|冰淇淋|Gelato|可颂|贝果|奶茶|甜甜圈|巧克力|饼干|蝴蝶饼|Acai|果汁|肉桂卷|柠檬茶/i.test(t)) return "甜品咖啡";
  if (/酒吧|Pub|酒馆/i.test(t)) return "酒吧";
  return "西餐";
}
const FAM_WORDS: [string, RegExp][] = [
  ["中餐", /中餐|中国菜|中式|中菜|中国餐|chinese/i], ["日料", /日料|日本菜|日餐|日本料理|japanese/i],
  ["韩餐", /韩餐|韩国菜|韩料|韩式料理|korean/i], ["西餐", /西餐|western/i], ["东南亚", /东南亚|south\s*east\s*asian/i],
];
const famOf = (q: string) => FAM_WORDS.find(([, re]) => re.test(q))?.[0];
const NEAR = /附近|近一点|离我|周边|旁边|nearby|near me/i;

// suburbs and landmarks named in the addresses; a question naming one is anchored there
const PLACE_ALIAS: Record<string, string> = { "唐人街": "Haymarket", "宝活": "Burwood", "博伍德": "Burwood", "车士活": "Chatswood", "伊士活": "Eastwood", "依士活": "Eastwood", "好市围": "Hurstville", "罗兹": "Rhodes", "史卓菲": "Strathfield", "艾平": "Epping", "康科德": "Concord" };
let PLACES: string[] = [], PLACES_AT = -1;
function places(rows: R[]) {
  if (PLACES_AT !== loadedAt) {
    const set = new Set<string>();
    for (const d of rows) for (const p of d.a.split(/[（）(),，/·、]/)) { const x = p.trim(); if (/^[A-Z][A-Za-z' ]{3,}$/.test(x) && !/ (St|Rd|Ave)$/.test(x)) set.add(x); }
    PLACES = [...set].sort((a, b) => b.length - a.length);
    PLACES_AT = loadedAt;
  }
  return PLACES;
}
function placeOf(rows: R[], q: string) {
  for (const [k, v] of Object.entries(PLACE_ALIAS)) if (q.includes(k)) return v;
  const low = q.toLowerCase();
  return places(rows).find((p) => new RegExp(`(^|[^a-z])${p.toLowerCase()}([^a-z]|$)`).test(low));
}
function centroid(rows: R[], place: string) {
  const re = new RegExp(`(^|[^a-z])${place.toLowerCase()}([^a-z]|$)`);
  const pts = rows.filter((d) => d.xy && re.test(d.a.toLowerCase())).map((d) => pos(d));
  if (!pts.length) return undefined;
  return { lat: pts.reduce((s, p) => s + p.lat, 0) / pts.length, lon: pts.reduce((s, p) => s + p.lon, 0) / pts.length };
}
const rate = (d: R) => (d.r === "X" ? 0 : parseFloat(d.r) || 0);

// hard constraints read from the question, or carried over from the last turns
export function constraints(rows: R[], q: string, turns: Turn[], here?: { lat: number; lon: number }) {
  const qs = [q, ...turns.slice(-3).map((t) => t.q ?? "").reverse()];
  let place: string | undefined, region: string | undefined, near = false;
  for (const s of qs) { const p = placeOf(rows, s), r = regionOf(s), n = NEAR.test(s); if (p || r || n) { place = p; region = p ? undefined : r; near = n; break; } }
  let fam: string | undefined;
  for (const s of qs) { const f = famOf(s); if (f) { fam = f; break; } }
  const anchor = place ? centroid(rows, place) : near && here ? here : undefined;
  if (!anchor && !region && !fam) return undefined;
  let pool = rows.filter((d) => d.r !== "X" && (!fam || famOfType(d.t) === fam) && (!region || d.rg === region));
  const dist = new Map<number, number>();
  if (anchor) {
    pool = pool.filter((d) => d.xy);
    for (const d of pool) dist.set(d.id, km(anchor, pos(d)));
    pool.sort((a, b) => dist.get(a.id)! - dist.get(b.id)!);
    let r = 4; while (r < 15 && pool.filter((d) => dist.get(d.id)! <= r).length < 6) r += 3;
    pool = pool.filter((d) => dist.get(d.id)! <= r).slice(0, 40);
  }
  return { place, region, fam, anchor, pool, dist, near };
}

// things only the review text can tell (quiet, mood, kids, booking, parking, queues);
// the model must not guess them from unrelated lines such as "不用排队"
const ATTRS: { name: string; q: RegExp; yes: RegExp; no?: RegExp }[] = [
  { name: "安静", q: /安静|清静|不吵|人少|聊天|谈事|说话/, yes: /安静|清静|不吵|人少|私密|包间|包厢|节奏舒服/, no: /(?<!不用|不|无需)排队|热闹|吵|嘈杂|拥挤|拼桌|很火|人气|爆满|坐满/ },
  { name: "氛围", q: /氛围|约会|浪漫|情调|纪念日/, yes: /氛围|浪漫|灯光|烛光|约会|情调|景色|海景|夜景/ },
  { name: "带娃或宽敞", q: /带娃|小孩|孩子|宝宝|宽敞|婴儿车|一家/, yes: /宽敞|带娃|小孩|儿童|宝宝|一家老小|场地大|空间大/ },
  { name: "能订位", q: /订位|预订|预约|book/i, yes: /订位|预约|预订|book|reservation/i, no: /不接受预订|不能订|不订位|不接受预约|walk.?in/i },
  { name: "好停车", q: /停车|开车去|parking/i, yes: /停车|车位|parking/i },
  { name: "不用排队", q: /不用排队|不排队|不想排队|不等位/, yes: /不用排队|不排队|人少|不用等/, no: /(?<!不用|不|无需)排队|等位|等餐约|要等/ },
];
export function attrsOf(q: string) { return ATTRS.filter((a) => a.q.test(q)); }
export function evidence(d: R, a: { yes: RegExp; no?: RegExp }) {
  const t = d.i ?? "";
  const cut = (re: RegExp) => { const m = re.exec(t); return m ? t.slice(Math.max(0, m.index - 12), m.index + 16) : ""; };
  return { no: a.no ? cut(a.no) : "", yes: cut(a.yes) };
}

const PICK_SYS = `你是悉尼餐厅检索器。下面是全部餐厅目录，每行格式：id|店名|大区|地址|菜系|星级|人均|招牌菜。用户开了定位时，问题后面会附上离他最近的店和距离。
大区的含义：市区（CBD、唐人街、Haymarket、Darling Harbour）；城南（Surry Hills、Redfern、Zetland、Mascot）；东区（Darlinghurst、Paddington、Potts Point、Bondi）；内西（Inner West：Burwood、Strathfield、Rhodes、Concord、Newtown、Glebe、Marrickville、Five Dock）；西区（Lidcombe、Auburn、Parramatta、Wentworth Point）；北区（Eastwood、Ryde、Epping、Macquarie Park、Carlingford）；北岸（North Shore：Chatswood、North Sydney、Crows Nest、Lane Cove、Hornsby）；山区（Castle Hill、Norwest、Baulkham Hills）；南区（Hurstville、Miranda）。
用户说了大区或具体区域时，只能选在那里的店，不能用别的区凑数。
根据用户最新的需求（结合之前的对话），从目录中选出最多 8 家最可能符合的候选，按匹配度排序。
规则：只能选目录里存在的 id；默认不选"不推荐"的店，除非用户在问哪些店别去；附上了最近的店且用户提到附近、近一点时，优先从那里面选；尽量照顾区域、人均、菜系、场合这些条件。
只输出 JSON：{"ids":[整数...],"need":"一句话概括用户需求"}`;

const ANSWER_SYS = `你是「悉尼吃喝」网站的 AI 智能顾问。网站的所有点评都是站长老杨自己去吃过后写的，你的判断只能依据这些点评，不要编造点评里没有的信息（例如营业时间、价格以外的细节）。
从候选里挑 1 到 3 家最合适的店回答用户。每家给出：
why：为什么适合这个需求，一句话，不超过 35 个字；
quote：从这家店的点评原文里一字不改地摘一句最能说服人的话，不超过 20 个字，必须是原文连续的一段；
tip：点什么或要注意什么，不超过 18 个字，没有就留空。
say：一句开场，不超过 25 个字。
follow：两条用户接下来可能会说的话，用用户自己的口吻写成要求，例如"便宜一点的"、"换到北岸"、"有没有不用排队的"，每条不超过 12 个字，不要向用户提问。
候选后面如果写了"营业中"或"已打烊"，那是 Google 实时的营业状态：用户问现在去吃时不要推荐已打烊的店；可以在 tip 里提一句几点打烊。
用户要求的条件（安静、氛围、带娃、能订位、停车、排队等）只有点评原文明确写到才算满足，不要从别的话推断，例如"不用排队"不等于安静，"人均不高"不等于人少。候选后面标了【条件】的，按标注判断：标"点评没写"的店，why 里不能说它满足这个条件；标"点评相反"的店不要推荐。如果没有一家点评明确写到，就在 say 里直说点评没写到这一点，再按其他条件推荐，并提醒用户自己留意。
如果候选都不太合适，诚实说明，并建议怎么放宽条件。
语气像一个懂吃的朋友，简洁，不用感叹号堆砌，不要使用破折号。回答语言按消息末尾的要求。
只输出 JSON：{"say":"","picks":[{"id":整数,"why":"","quote":"","tip":""}],"follow":["",""]}`;

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
    await loadReal();
    const here = typeof body.lat === "number" && typeof body.lon === "number" ? { lat: body.lat, lon: body.lon } : undefined;
    const turns = Array.isArray(body.turns) ? body.turns : [];
    // step 1: pick candidates from the whole catalogue (cached prompt when there is no location)
    const sys1 = [{ type: "text", text: PICK_SYS }, { type: "text", text: catalogue(rows), cache_control: { type: "ephemeral" } }];
    const c = constraints(rows, q, turns, here);
    const want = c?.region;
    let q1 = here ? `${q}\n\n（离我最近的店，id:距离）${nearest(rows, here)}` : q;
    if (c?.pool.length) q1 = `${q}\n\n（符合${[c.place, c.region, c.fam].filter(Boolean).join("、") || "附近"}条件的店，只能从这里面选${c.anchor ? "，id:距离" : ""}）${c.pool.map((d) => c.anchor ? `${d.id}:${c.dist.get(d.id)!.toFixed(1)}km` : d.id).join(" ")}`;
    // follow-ups bring new places: anything already shown is out, unless the question points back at it
    const shown = new Set(turns.flatMap((t) => (t.ids ?? []).map(Number)));
    const backRef = /刚才|上面|这几家|那几家|第[一二三123]家|前面|哪一家|对比|比较/.test(q) || [...shown].some((i) => { const d = BY_ID.get(i); return d && (q.includes(d.n.slice(0, 4)) || (d.ne && q.toLowerCase().includes(d.ne.toLowerCase().slice(0, 6)))); });
    const fresh = (i: number) => backRef || !shown.has(i);
    if (shown.size && !backRef) q1 += `\n\n（已经推荐过的店，这次不要再选：${[...shown].join(" ")}）`;
    const at = attrsOf(q);
    for (const a of at) {
      const base = c?.pool.length ? c.pool : rows.filter((d) => d.r !== "X");
      const yes = base.filter((d) => { const e = evidence(d, a); return e.yes && !e.no; }).map((d) => d.id);
      q1 += `\n\n（"${a.name}"只能看点评原文：点评明确提到的店 ${yes.length ? yes.slice(0, 30).join(" ") : "没有"}；其余店点评没写，不能当作满足）`;
    }
    const t1 = Date.now();
    const p1 = await claudeJSON(MODEL_PICK, sys1, [...history(turns), { role: "user", content: q1 }], 800);
    // if the reply was not JSON, take any known ids that appear in it
    const raw1: number[] = p1.ids ?? (String(p1._raw ?? "").match(/\d+/g) ?? []);
    let ids: number[] = [...new Set(raw1.map(Number))].filter((i: number) => BY_ID.has(i)).slice(0, 8);
    // place, region and cuisine are hard limits: drop anything outside, top up from the pool
    if (c?.pool.length) {
      const ok = new Set(c.pool.map((d) => d.id));
      ids = ids.filter((i) => ok.has(i));
      if (ids.length < 3) {
        const extra = [...c.pool].sort((a, b) => rate(b) - rate(a) || (c.dist.get(a.id) ?? 0) - (c.dist.get(b.id) ?? 0)).map((d) => d.id).filter((i) => !ids.includes(i));
        ids = ids.concat(extra).slice(0, 6);
      }
    }
    ids = ids.filter(fresh);
    if (c?.pool.length && ids.length < 3) ids = ids.concat([...c.pool].sort((a, b) => rate(b) - rate(a)).map((d) => d.id).filter((i) => fresh(i) && !ids.includes(i))).slice(0, 6);
    // a review that says the opposite (queues, crowds) rules a place out
    for (const a of at) if (a.no) { const kept = ids.filter((i) => !evidence(BY_ID.get(i)!, a).no); if (kept.length) ids = kept; }
    // never come back empty: fall back to a keyword match over the reviews, then to the best rated places
    let note = "";
    if (!ids.length) {
      ids = fallbackIds(rows.filter((d) => fresh(d.id)), q, want);
      if (NEAR.test(q) && !here && !c?.place) note = /[\u4e00-\u9fff]/.test(q) ? "没拿到你的位置，先按口碑推荐几家；点输入框左边的定位按钮，就能按距离推荐。" : "I could not get your location, so here are well rated picks. Tap the pin by the input box for nearby ones.";
    }
    // opening hours: when the question is about now (or it is late), drop places Google says are closed
    const nowQ = !LATER.test(q) && (NOW.test(q) || lateNow());
    let H = await hours(ids.slice(0, 8));
    if (nowQ) {
      const open = ids.filter((i) => H[i]?.open !== false);
      if (open.length) ids = open;
      else if (Object.keys(H).length) note = (note ? note + " " : "") + (/[\u4e00-\u9fff]/.test(q) ? "符合条件的店现在都打烊了，下面是营业时间最合适的几家。" : "Everything that fits is closed right now; these are the best for later.");
    }
    // step 2: full reviews of the candidates, choose and explain
    const cand = ids.map((i) => BY_ID.get(i)!).map((d) => {
      const dist = here && d.xy ? ` 距离你${km(here, pos(d)).toFixed(1)}km` : c?.place && c.dist.has(d.id) ? ` 离${c.place}${c.dist.get(d.id)!.toFixed(1)}km` : "";
      return `[${d.id}] ${d.n}${d.ne && d.ne !== d.n ? ` (${d.ne})` : ""}｜${d.rg ?? ""}｜${d.a}｜${d.t}｜${stars(d.r)}｜人均$${d.p ?? "?"}${d.pe ? "(估)" : ""}${dist}${H[d.id]?.line ? `｜${H[d.id].line}` : ""}\n招牌：${d.d ?? ""}\n点评：${d.i ?? ""}${at.map((a) => { const e = evidence(d, a); return `\n【${a.name}】${e.no ? `点评相反：…${e.no}…` : e.yes ? `点评提到：…${e.yes}…` : "点评没写"}`; }).join("")}`;
    }).join("\n\n");
    const zh = /[\u4e00-\u9fff]/.test(q);
    const mustL = c ? [c.place && `在 ${c.place} 附近`, c.region && `在${c.region}`, c.fam && `只要${c.fam}`].filter(Boolean) : [];
    const must = mustL.length ? `\n硬性条件：${mustL.join("，")}。候选已按条件筛好。` : "";
    const msg = `用户需求：${q}${must}\n（概括：${p1.need ?? ""}）\n\n候选餐厅：\n${cand}\n\n${zh ? "请用中文回答（say、why、tip、follow 都用中文）。" : "Answer in English (say, why, tip, follow in English; keep quote in the original Chinese)."}`;
    const t2 = Date.now();
    let p2 = await claudeJSON(MODEL_ANSWER, ANSWER_SYS, [...history(turns), { role: "user", content: msg }], 2000);
    // last resort: show the top candidates with the opening of each review
    if (p2._raw !== undefined) p2 = { say: "按你的条件，这几家最接近：", picks: ids.slice(0, 3).map((i) => ({ id: i, why: short(BY_ID.get(i)?.i, 60), quote: "", tip: "" })), follow: [] };
    const picks = (p2.picks ?? []).filter((p: { id: number }) => ids.includes(Number(p.id))).slice(0, 3).map((p: { id: number; why?: string; quote?: string; tip?: string }) => {
      const d = BY_ID.get(Number(p.id))!;
      const quote = p.quote && d.i && d.i.includes(String(p.quote).replace(/[「」“”"]/g, "")) ? String(p.quote).replace(/[「」“”"]/g, "") : "";
      return { id: d.id, why: String(p.why ?? ""), quote, tip: String(p.tip ?? ""), km: here && d.xy ? Number(km(here, pos(d)).toFixed(1)) : undefined, hours: H[d.id]?.line || undefined };
    });
    const miss = picks.filter((p: { id: number; hours?: string }) => !p.hours).map((p: { id: number }) => p.id);
    if (miss.length) { const H2 = await hours(miss); for (const p of picks as { id: number; hours?: string }[]) if (!p.hours && H2[p.id]?.line) p.hours = H2[p.id].line; }
    return out({ say: (note ? note + " " : "") + String(p2.say ?? ""), picks, follow: (p2.follow ?? []).slice(0, 2).map(String), ms: Date.now() - t0, ms_pick: t2 - t1 });
  } catch (e) {
    console.error(e);
    return out({ error: "ai_failed" }, 502);
  }
}

if (import.meta.main) Deno.serve(handle);
