// 悉尼吃喝 Google 地点：Supabase Edge Function "place"
// Deploy: Edge Functions > Deploy a new function > Via Editor, name it "place", paste this file,
// then turn OFF "Enforce JWT verification" for it (the site calls it with the public key only).
// Secrets: GOOGLE_PLACES_KEY (required). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
// Optional: DAY_CAP_DETAILS (live lookups per day per instance, default 60).
//
// What is kept, following Google's caching rules: only the place ID (forever) and the coordinates
// (refreshed every 3 weeks, wiped after 30 days). Opening hours, status and the review summary are
// fetched live and only held in memory for a few hours to avoid paying twice for the same lookup.
//
// POST {op:"sync", limit?:40}        match unmatched places and refresh stale coordinates; returns a report
// POST {op:"info", ids:[..], full?}  live opening hours (and, with full, Google's AI review summary)
// POST {op:"coords"}                 [[id, lat, lon], ...] for places with fresh coordinates

const GKEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const GURL = Deno.env.get("GOOGLE_PLACES_URL") ?? "https://places.googleapis.com/v1";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "https://hmipkgllqnyvabcntipb.supabase.co";
const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DATA_URL = Deno.env.get("DATA_URL") ?? "https://ian233.com/eat/data.json";
const DAY_CAP = Number(Deno.env.get("DAY_CAP_DETAILS") ?? 60);
const ORIGINS = ["https://ian233.com", "https://www.ian233.com", "http://localhost:8765"];
const TZ = "Australia/Sydney";

type R = { id: number; n: string; ne?: string; a: string; xy?: [number, number] };
type Row = { rid: number; place_id: string | null; lat: number | null; lon: number | null; loc_at: string | null; score: number | null };

// ---------- data and table ----------
let DATA: R[] = [], dataAt = 0;
async function data() {
  if (!DATA.length || Date.now() - dataAt > 3600_000) {
    const r = await fetch(DATA_URL, { headers: { "cache-control": "no-cache" } });
    if (!r.ok) throw new Error("data " + r.status);
    DATA = await r.json(); dataAt = Date.now();
  }
  return DATA;
}
const sbh = () => ({ apikey: SB_SVC, authorization: "Bearer " + SB_SVC, "content-type": "application/json" });
async function rows(): Promise<Row[]> {
  const r = await fetch(`${SB_URL}/rest/v1/place_map?select=rid,place_id,lat,lon,loc_at,score`, { headers: sbh() });
  if (!r.ok) throw new Error("table " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
async function upsert(list: Partial<Row>[]) {
  if (!list.length) return;
  const r = await fetch(`${SB_URL}/rest/v1/place_map?on_conflict=rid`, { method: "POST", headers: { ...sbh(), prefer: "resolution=merge-duplicates" }, body: JSON.stringify(list) });
  if (!r.ok) throw new Error("upsert " + r.status + " " + (await r.text()).slice(0, 200));
}

// ---------- Google ----------
async function g(path: string, mask: string, body?: unknown, lang = "zh-CN") {
  const url = `${GURL}/${path}${body ? "" : (path.includes("?") ? "&" : "?") + "languageCode=" + lang + "&regionCode=AU"}`;
  const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "x-goog-api-key": GKEY, "x-goog-fieldmask": mask, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) throw new Error("google " + r.status + " " + (await r.text()).slice(0, 300));
  return await r.json();
}
// sketch map coordinates back to lat/lon (same formula as the site)
const toLL = (xy: [number, number]) => ({ lon: xy[0] * 0.38 / 1000 + 150.93, lat: -33.69 - xy[1] * 0.36 / 1140.7 });
function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
// how alike two names are: shared characters for Chinese, shared words for English
function alike(a: string, b: string) {
  const norm = (s: string) => s.toLowerCase().replace(/[（(].*?[）)]/g, "").replace(/[^a-z0-9一-鿿 ]/g, " ");
  const A = norm(a), B = norm(b);
  const zh = (s: string) => new Set([...s.replace(/[^一-鿿]/g, "")]);
  const en = (s: string) => new Set(s.split(/\s+/).filter((w) => w.length > 1 && !["the", "and", "restaurant", "cafe", "sydney", "bar"].includes(w)));
  const j = (x: Set<string>, y: Set<string>) => { if (!x.size || !y.size) return 0; let n = 0; x.forEach((c) => y.has(c) && n++); return n / Math.min(x.size, y.size); };
  return Math.max(j(zh(A), zh(B)), j(en(A), en(B)));
}
const plain = (s: string) => s.replace(/（.*?）|\(.*?\)/g, "").trim();

async function match(d: R) {
  const near = d.xy ? toLL(d.xy) : { lat: -33.87, lon: 151.21 };
  const q = `${plain(d.ne || d.n)} ${plain(d.a)} Sydney`;
  const j = await g("places:searchText", "places.id,places.displayName,places.formattedAddress,places.location,places.businessStatus",
    { textQuery: q, regionCode: "AU", languageCode: "en", maxResultCount: 5, locationBias: { circle: { center: { latitude: near.lat, longitude: near.lon }, radius: 8000 } } });
  const best = (j.places ?? []).map((p: any) => {
    const name = p.displayName?.text ?? "";
    const s = Math.max(alike(d.n, name), d.ne ? alike(d.ne, name) : 0);
    const far = p.location ? km(near, { lat: p.location.latitude, lon: p.location.longitude }) : 99;
    return { p, name, s: s - (far > 12 ? 0.3 : 0) };
  }).sort((a: any, b: any) => b.s - a.s)[0];
  return best;
}

// ---------- live info, held in memory only ----------
const CACHE = new Map<string, { at: number; v: unknown }>();
const TTL = 6 * 3600_000;
let day = "", used = 0;
function budget() { const d = new Date().toISOString().slice(0, 10); if (d !== day) { day = d; used = 0; } return used < DAY_CAP; }
const hm = (iso?: string) => iso ? new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "";
const dayOf = (iso?: string) => {
  if (!iso) return "";
  const f = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  const t = f(new Date()), x = f(new Date(iso)), tm = f(new Date(Date.now() + 86400_000));
  return x === t ? "" : x === tm ? "明天 " : new Intl.DateTimeFormat("zh-CN", { timeZone: TZ, weekday: "short" }).format(new Date(iso)) + " ";
};
async function info(placeId: string, full: boolean) {
  const key = placeId + (full ? ":f" : "");
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.v;
  if (!budget()) return null;
  used++;
  const mask = "businessStatus,currentOpeningHours.openNow,currentOpeningHours.nextOpenTime,currentOpeningHours.nextCloseTime,currentOpeningHours.weekdayDescriptions"
    + (full ? ",reviewSummary,generativeSummary" : "");
  const p = await g(`places/${encodeURIComponent(placeId)}`, mask);
  const h = p.currentOpeningHours;
  const status = p.businessStatus ?? "";
  let line = "";
  if (status === "CLOSED_PERMANENTLY") line = "已永久停业";
  else if (status === "CLOSED_TEMPORARILY") line = "暂停营业";
  else if (h?.openNow === true) line = h.nextCloseTime ? `营业中 · ${dayOf(h.nextCloseTime)}${hm(h.nextCloseTime)} 打烊` : "营业中";
  else if (h?.openNow === false) line = h.nextOpenTime ? `已打烊 · ${dayOf(h.nextOpenTime)}${hm(h.nextOpenTime)} 开门` : "已打烊";
  const v: Record<string, unknown> = { open: status && status !== "OPERATIONAL" ? false : h?.openNow ?? null, line, week: h?.weekdayDescriptions ?? [], status };
  if (full) {
    const rs = p.reviewSummary, gs = p.generativeSummary;
    v.summary = rs?.text?.text ?? gs?.overview?.text ?? "";
    v.disclosure = rs?.disclosureText?.text ?? gs?.disclosureText?.text ?? "";
    v.reviewsUri = rs?.reviewsUri ?? "";
  }
  CACHE.set(key, { at: Date.now(), v });
  return v;
}

// ---------- http ----------
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
  if (!GKEY) return out({ error: "no_key" }, 503);
  let body: { op?: string; ids?: number[]; full?: boolean; limit?: number };
  try { body = await req.json(); } catch { return out({ error: "bad_json" }, 400); }
  try {
    const table = await rows();
    const byRid = new Map(table.map((r) => [r.rid, r]));

    if (body.op === "coords") {
      const fresh = table.filter((r) => r.lat != null && r.loc_at && Date.now() - Date.parse(r.loc_at) < 30 * 86400_000);
      return out(fresh.map((r) => [r.rid, +r.lat!.toFixed(6), +r.lon!.toFixed(6)]));
    }

    if (body.op === "info") {
      const ids = [...new Set((body.ids ?? []).map(Number))].slice(0, body.full ? 1 : 8);
      const res: Record<number, unknown> = {};
      await Promise.all(ids.map(async (id) => {
        const pid = byRid.get(id)?.place_id;
        if (!pid) return;
        try { const v = await info(pid, !!body.full); if (v) res[id] = v; } catch (e) { console.error("info", id, String(e)); }
      }));
      return out(res);
    }

    if (body.op === "sync") {
      // idempotent: only touches places never matched, or whose coordinates are older than 21 days
      const all = await data();
      const limit = Math.min(Number(body.limit ?? 40), 80);
      const stale = (r?: Row) => !r || !r.loc_at || Date.now() - Date.parse(r.loc_at) > 21 * 86400_000;
      const todo = all.filter((d) => stale(byRid.get(d.id))).slice(0, limit);
      const report: unknown[] = [], put: Partial<Row>[] = [];
      for (const d of todo) {
        const r = byRid.get(d.id);
        try {
          if (r?.place_id) {
            const p = await g(`places/${encodeURIComponent(r.place_id)}`, "location,businessStatus");
            put.push({ rid: d.id, place_id: r.place_id, lat: p.location?.latitude ?? null, lon: p.location?.longitude ?? null, loc_at: new Date().toISOString(), score: r.score });
            if (p.businessStatus && p.businessStatus !== "OPERATIONAL") report.push({ id: d.id, n: d.n, status: p.businessStatus });
          } else {
            const b = await match(d);
            if (!b) { put.push({ rid: d.id, place_id: null, lat: null, lon: null, loc_at: new Date().toISOString(), score: 0 }); report.push({ id: d.id, n: d.n, miss: true }); continue; }
            const s = Math.max(0, Math.min(1, b.s));
            const ok = s >= 0.34;
            put.push({ rid: d.id, place_id: ok ? b.p.id : null, lat: ok ? b.p.location?.latitude : null, lon: ok ? b.p.location?.longitude : null, loc_at: new Date().toISOString(), score: +s.toFixed(2) });
            if (!ok || s < 0.6) report.push({ id: d.id, n: d.n, google: b.name, addr: b.p.formattedAddress, score: +s.toFixed(2), kept: ok, place_id: b.p.id });
            if (ok && b.p.businessStatus && b.p.businessStatus !== "OPERATIONAL") report.push({ id: d.id, n: d.n, status: b.p.businessStatus });
          }
        } catch (e) { report.push({ id: d.id, n: d.n, error: String(e).slice(0, 120) }); }
      }
      await upsert(put);
      // Google allows coordinates for 30 days at most: wipe any that slipped past
      const old = table.filter((r) => r.lat != null && r.loc_at && Date.now() - Date.parse(r.loc_at) > 30 * 86400_000 && !todo.some((d) => d.id === r.rid));
      await upsert(old.map((r) => ({ ...r, lat: null, lon: null })));
      const left = all.filter((d) => stale(byRid.get(d.id))).length - todo.length;
      return out({ done: put.length, left, report });
    }
    return out({ error: "op" }, 400);
  } catch (e) {
    console.error(e);
    return out({ error: "failed", detail: String(e).slice(0, 200) }, 502);
  }
}

if (import.meta.main) Deno.serve(handle);
