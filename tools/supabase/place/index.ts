// 悉尼吃喝 Google 地点：Supabase Edge Function "place"
// Deploy: Edge Functions > Deploy a new function > Via Editor, name it "place", paste this file,
// then turn OFF "Enforce JWT verification" for it (the site calls it with the public key only).
// Secrets: GOOGLE_PLACES_KEY (required). SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
//
// Everything is stored in the place_map table and refreshed once a month (opening hours, status,
// coordinates, AI review summary). Note: Google's terms only allow keeping place IDs long term; the
// site owner chose to store the rest anyway. Pages and 饭搭子 read from the table, not from Google.
//
// POST {op:"sync", limit?:40}        match unmatched places and refresh stale coordinates; returns a report
// POST {op:"info", ids:[..], full?}  opening hours now (and, with full, the weekly hours and AI review summary)
// POST {op:"all"}                   [[id, open, line], ...] for every matched place
// POST {op:"coords"}                 [[id, lat, lon], ...] for places with fresh coordinates

const GKEY = Deno.env.get("GOOGLE_PLACES_KEY") ?? "";
const GURL = Deno.env.get("GOOGLE_PLACES_URL") ?? "https://places.googleapis.com/v1";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "https://hmipkgllqnyvabcntipb.supabase.co";
const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const DATA_URL = Deno.env.get("DATA_URL") ?? "https://ian233.com/eat/data.json";
const ORIGINS = ["https://ian233.com", "https://www.ian233.com", "http://localhost:8765"];
const TZ = "Australia/Sydney";

type R = { id: number; n: string; ne?: string; a: string; xy?: [number, number] };
type P = { open: { day: number; hour: number; minute: number }; close?: { day: number; hour: number; minute: number } };
type Row = { rid: number; place_id: string | null; lat: number | null; lon: number | null; status: string | null; periods: P[] | null; week: string[] | null; summary: string | null; disclosure: string | null; reviews_uri: string | null; score: number | null; fetched_at: string | null };

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
  const r = await fetch(`${SB_URL}/rest/v1/place_map?select=*`, { headers: sbh() });
  if (!r.ok) throw new Error("table " + r.status + " " + (await r.text()).slice(0, 200));
  return await r.json();
}
async function upsert(list: Partial<Row>[]) {
  if (!list.length) return;
  // PostgREST wants every row in a batch to have the same keys
  const keys = ["rid", "place_id", "lat", "lon", "status", "periods", "week", "summary", "disclosure", "reviews_uri", "score", "fetched_at"] as const;
  list = list.map((r) => Object.fromEntries(keys.map((k) => [k, (r as Record<string, unknown>)[k] ?? null])) as Partial<Row>);
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

// ---------- opening hours from the stored periods ----------
function sydNow() {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"));
  return day * 1440 + Number(g("hour")) * 60 + Number(g("minute"));
}
const WEEK = 7 * 1440;
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (m: number) => `${pad(Math.floor((m % 1440) / 60))}:${pad(m % 60)}`;
const DAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
function when(now: number, at: number) { // "" today, "明天 " or "周三 "
  const d0 = Math.floor(now / 1440), d1 = Math.floor(at / 1440) % 7, diff = (d1 - (d0 % 7) + 7) % 7;
  return diff === 0 && at - now < 1440 ? "" : diff === 1 ? "明天 " : DAYS[d1] + " ";
}
export function openState(r: Pick<Row, "status" | "periods">, now = sydNow()) {
  if (r.status === "CLOSED_PERMANENTLY") return { open: false, line: "已永久停业" };
  if (r.status === "CLOSED_TEMPORARILY") return { open: false, line: "暂停营业" };
  const ps = r.periods ?? [];
  if (!ps.length) return { open: null, line: "" };
  if (ps.length === 1 && !ps[0].close) return { open: true, line: "24 小时营业" };
  let nextOpen = Infinity;
  for (const p of ps) {
    const s = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let e = p.close ? p.close.day * 1440 + p.close.hour * 60 + p.close.minute : s + 1440;
    if (e <= s) e += WEEK;
    for (const n of [now, now + WEEK]) if (n >= s && n < e) {
      const endRel = e - (n - now); // closing time on now's timeline
      const next = Math.floor(endRel / 1440) > Math.floor(now / 1440) && endRel % 1440 !== 0 ? "次日 " : "";
      return { open: true, line: `营业中 · ${next}${clock(endRel % WEEK)} 打烊` };
    }
    const wait = (s - now + WEEK) % WEEK;
    if (wait < nextOpen) nextOpen = wait;
  }
  if (nextOpen === Infinity) return { open: false, line: "已打烊" };
  const at = (now + nextOpen) % WEEK;
  return { open: false, line: `已打烊 · ${when(now, now + nextOpen)}${clock(at)} 开门` };
}
function info(r: Row, full: boolean) {
  const st = openState(r);
  const v: Record<string, unknown> = { ...st, status: r.status ?? "" };
  if (full) Object.assign(v, { week: r.week ?? [], summary: r.summary ?? "", disclosure: r.disclosure ?? "", reviewsUri: r.reviews_uri ?? "" });
  return v;
}
// one Google call for everything we keep about a place
const DETAIL = "id,location,businessStatus,regularOpeningHours.periods,regularOpeningHours.weekdayDescriptions,reviewSummary,generativeSummary";
function fromDetail(p: any): Partial<Row> {
  const rs = p.reviewSummary, gs = p.generativeSummary;
  return {
    lat: p.location?.latitude ?? null, lon: p.location?.longitude ?? null, status: p.businessStatus ?? null,
    periods: p.regularOpeningHours?.periods ?? null, week: p.regularOpeningHours?.weekdayDescriptions ?? null,
    summary: rs?.text?.text ?? gs?.overview?.text ?? null, disclosure: rs?.disclosureText?.text ?? gs?.disclosureText?.text ?? null,
    reviews_uri: rs?.reviewsUri ?? null, fetched_at: new Date().toISOString(),
  };
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

    if (body.op === "coords") return out(table.filter((r) => r.lat != null).map((r) => [r.rid, +r.lat!.toFixed(6), +r.lon!.toFixed(6)]));

    if (body.op === "all") return out(table.filter((r) => r.place_id).map((r) => { const s = openState(r); return [r.rid, s.open, s.line]; }));

    if (body.op === "info") {
      const ids = [...new Set((body.ids ?? []).map(Number))].slice(0, 20);
      const res: Record<number, unknown> = {};
      for (const id of ids) { const r = byRid.get(id); if (r?.place_id && r.fetched_at) res[id] = info(r, !!body.full); }
      return out(res);
    }

    if (body.op === "sync") {
      // idempotent: only touches places never fetched, or fetched more than 28 days ago
      const all = await data();
      const limit = Math.min(Number(body.limit ?? 40), 80);
      const stale = (r?: Row) => !r || !r.fetched_at || Date.now() - Date.parse(r.fetched_at) > 28 * 86400_000;
      const todo = all.filter((d) => stale(byRid.get(d.id))).slice(0, limit);
      const report: unknown[] = [], put: Partial<Row>[] = [];
      for (const d of todo) {
        const r = byRid.get(d.id);
        try {
          let pid = r?.place_id ?? null, score = r?.score ?? null;
          if (!pid) {
            const b = await match(d);
            const s = b ? Math.max(0, Math.min(1, b.s)) : 0;
            score = +s.toFixed(2);
            if (!b || s < 0.34) {
              put.push({ rid: d.id, place_id: null, score, fetched_at: new Date().toISOString() });
              report.push(b ? { id: d.id, n: d.n, google: b.name, addr: b.p.formattedAddress, score, kept: false, place_id: b.p.id } : { id: d.id, n: d.n, miss: true });
              continue;
            }
            pid = b.p.id;
            if (s < 0.6) report.push({ id: d.id, n: d.n, google: b.name, addr: b.p.formattedAddress, score, kept: true });
          }
          const p = await g(`places/${encodeURIComponent(pid!)}`, DETAIL);
          const row = { rid: d.id, place_id: pid, score, ...fromDetail(p) };
          put.push(row);
          if (row.status && row.status !== "OPERATIONAL") report.push({ id: d.id, n: d.n, status: row.status });
        } catch (e) { report.push({ id: d.id, n: d.n, error: String(e).slice(0, 120) }); }
      }
      await upsert(put);
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
