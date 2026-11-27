-- 悉尼吃喝 照片功能：在 Supabase 后台 SQL Editor 里整段运行一次即可（可重复运行）

-- 1. 管理员名单
create table if not exists public.admins (
  uid uuid primary key references auth.users(id) on delete cascade
);
alter table public.admins enable row level security;
drop policy if exists "admins read self" on public.admins;
create policy "admins read self" on public.admins for select using (uid = auth.uid());
grant select on public.admins to authenticated;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where uid = auth.uid())
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 2. 照片表：rid 对应网站数据里每家店的 id
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  rid int not null,
  path text not null,
  thumb text not null,
  w int,
  h int,
  caption text,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid()
);
create index if not exists photos_rid_sort on public.photos (rid, sort);
alter table public.photos enable row level security;
drop policy if exists "photos read" on public.photos;
drop policy if exists "photos insert" on public.photos;
drop policy if exists "photos update" on public.photos;
drop policy if exists "photos delete" on public.photos;
create policy "photos read"   on public.photos for select using (true);
create policy "photos insert" on public.photos for insert to authenticated with check (public.is_admin());
create policy "photos update" on public.photos for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "photos delete" on public.photos for delete to authenticated using (public.is_admin());
grant select on public.photos to anon, authenticated;
grant insert, update, delete on public.photos to authenticated;

-- 3. 存储桶：公开可读，只有管理员能写；单张上限 5MB
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = true, file_size_limit = 5242880,
  allowed_mime_types = array['image/webp', 'image/jpeg'];
drop policy if exists "photos bucket insert" on storage.objects;
drop policy if exists "photos bucket update" on storage.objects;
drop policy if exists "photos bucket delete" on storage.objects;
create policy "photos bucket insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_admin());
create policy "photos bucket update" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_admin());
create policy "photos bucket delete" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- 4. 先在 Authentication > Users > Add user 建好你的账号（邮箱 + 密码，勾选 Auto Confirm），
--    再把下面的邮箱换成你的，运行这一句：
-- insert into public.admins (uid) select id from auth.users where email = '你的邮箱' on conflict do nothing;
