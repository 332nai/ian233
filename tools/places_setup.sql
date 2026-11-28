-- 悉尼吃喝 Google 地点：在 Supabase 的 SQL Editor 里整段运行一次（可重复运行）
-- 每家店一行：Google 地点 ID、坐标、营业状态、营业时间、AI 评论摘要。place 函数每月刷新一次。
-- 注意：Google Maps Platform 条款不允许长期保存地点 ID 和坐标以外的内容，这是站长知情后的选择。
create table if not exists public.place_map (
  rid int primary key,             -- 店的 id（data.json 里的 id）
  place_id text,                   -- Google 地点 ID
  lat double precision,
  lon double precision,
  status text,                     -- OPERATIONAL / CLOSED_TEMPORARILY / CLOSED_PERMANENTLY
  periods jsonb,                   -- regularOpeningHours.periods，用来算现在开没开
  week jsonb,                      -- 每周营业时间文字，周一到周日
  summary text,                    -- Google AI 评论摘要
  disclosure text,                 -- 摘要的署名，例如"由 Gemini 总结"
  reviews_uri text,
  score real,                      -- 店名匹配度，0 到 1，低的需要人工看一眼
  fetched_at timestamptz
);
alter table public.place_map add column if not exists status text;
alter table public.place_map add column if not exists periods jsonb;
alter table public.place_map add column if not exists week jsonb;
alter table public.place_map add column if not exists summary text;
alter table public.place_map add column if not exists disclosure text;
alter table public.place_map add column if not exists reviews_uri text;
alter table public.place_map add column if not exists fetched_at timestamptz;
alter table public.place_map enable row level security;  -- 没有任何策略：只有函数用 service role 读写

-- 看匹配结果：select rid, score, status, summary from place_map order by score nulls first limit 50;
-- 某家匹配错了：update place_map set place_id = '正确的ID', fetched_at = null where rid = 123;  下次同步会按新 ID 重查
-- 已停业的店：select rid, status from place_map where status <> 'OPERATIONAL';
