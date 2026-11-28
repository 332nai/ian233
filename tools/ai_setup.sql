-- 悉尼吃喝 AI 美食顾问：提问记录和限流。在 Supabase 的 SQL Editor 里整段运行一次（可重复运行）
create table if not exists public.ai_log (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  ip text,
  q text
);
alter table public.ai_log enable row level security;  -- no policies: nobody reads it through the API
create index if not exists ai_log_day on public.ai_log (created_at);

create or replace function public.ai_gate(p_ip text, p_q text, p_ip_cap int, p_day_cap int) returns text
language plpgsql security definer set search_path = public as $$
declare n_ip int; n_day int;
begin
  select count(*) into n_day from ai_log where created_at > now() - interval '1 day';
  if n_day >= p_day_cap then return 'day'; end if;
  select count(*) into n_ip from ai_log where ip = p_ip and created_at > now() - interval '1 day';
  if n_ip >= p_ip_cap then return 'ip'; end if;
  insert into ai_log (ip, q) values (left(p_ip, 32), left(p_q, 300));
  return 'ok';
end $$;
revoke all on function public.ai_gate(text, text, int, int) from public;
grant execute on function public.ai_gate(text, text, int, int) to anon, authenticated;

-- 想看大家都问了什么：select created_at, q from ai_log order by id desc limit 50;
