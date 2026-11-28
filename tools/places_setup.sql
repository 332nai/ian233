-- 悉尼吃喝 Google 地点：在 Supabase 的 SQL Editor 里整段运行一次（可重复运行）
-- Google 条款只允许长期保存地点 ID；经纬度最多保存 30 天，所以 place 函数每三周刷新一次，过期的会被清掉。
-- 营业时间、营业状态、评论摘要不落库，用到时实时查 Google。
create table if not exists public.place_map (
  rid int primary key,             -- 店的 id（data.json 里的 id）
  place_id text,                   -- Google 地点 ID，可长期保存
  lat double precision,            -- Google 坐标，最多保存 30 天
  lon double precision,
  loc_at timestamptz,              -- 坐标是哪天查的
  score real,                      -- 店名匹配度，0 到 1，低的需要人工看一眼
  checked_at timestamptz not null default now()
);
alter table public.place_map enable row level security;  -- 没有任何策略：只有函数用 service role 读写
create index if not exists place_map_loc_at on public.place_map (loc_at);

-- 想看匹配结果：select * from place_map order by score nulls first limit 50;
-- 某家匹配错了，手动改：update place_map set place_id = '正确的ID', loc_at = null where rid = 123;
