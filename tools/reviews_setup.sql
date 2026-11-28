-- 悉尼吃喝 网友评论：在 Supabase 的 SQL Editor 里整段运行一次（可重复运行）
-- 任何人填昵称就能提交，默认待审核；站长在 /eat/admin/reviews/ 通过后才公开显示。
-- 依赖照片功能里建好的 admins 表和 is_admin()。

create table if not exists public.reviews (
  id bigserial primary key,
  rid int not null,                                   -- 店的 id
  name text not null,                                 -- 昵称
  stars int not null check (stars between 1 and 5),
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'ok', 'hidden')),
  dev text,                                           -- 浏览器里的随机编号，只用来限流
  created_at timestamptz not null default now()
);
create index if not exists reviews_rid on public.reviews (rid, status, created_at desc);
create index if not exists reviews_dev on public.reviews (dev, created_at);
alter table public.reviews enable row level security;

-- 访客不能直接读写这张表，只能通过下面两个函数；管理员可以读、改状态、删除
drop policy if exists "reviews admin read" on public.reviews;
drop policy if exists "reviews admin update" on public.reviews;
drop policy if exists "reviews admin delete" on public.reviews;
create policy "reviews admin read"   on public.reviews for select to authenticated using (public.is_admin());
create policy "reviews admin update" on public.reviews for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "reviews admin delete" on public.reviews for delete to authenticated using (public.is_admin());
grant select, update, delete on public.reviews to authenticated;

-- 提交：检查长度，同一个浏览器一天最多 5 条，待审核超过 300 条时暂停收新评论
create or replace function public.review_submit(p_rid int, p_name text, p_stars int, p_body text, p_dev text) returns text
language plpgsql security definer set search_path = public as $$
declare n text := btrim(coalesce(p_name, '')); b text := btrim(coalesce(p_body, ''));
begin
  if p_rid is null or p_stars is null or p_stars < 1 or p_stars > 5 then return 'bad'; end if;
  if char_length(n) < 1 or char_length(n) > 20 then return 'name'; end if;
  if char_length(b) < 2 or char_length(b) > 500 then return 'body'; end if;
  if (select count(*) from reviews where dev = left(p_dev, 64) and created_at > now() - interval '1 day') >= 5 then return 'limit'; end if;
  if (select count(*) from reviews where status = 'pending') >= 300 then return 'busy'; end if;
  insert into reviews (rid, name, stars, body, dev) values (p_rid, n, p_stars, b, left(p_dev, 64));
  return 'ok';
end $$;
revoke all on function public.review_submit(int, text, int, text, text) from public;
grant execute on function public.review_submit(int, text, int, text, text) to anon, authenticated;

-- 读取：只返回审核通过的
create or replace function public.reviews_for(p_rid int) returns table (name text, stars int, body text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select name, stars, body, created_at from reviews where rid = p_rid and status = 'ok' order by created_at desc limit 50
$$;
revoke all on function public.reviews_for(int) from public;
grant execute on function public.reviews_for(int) to anon, authenticated;
