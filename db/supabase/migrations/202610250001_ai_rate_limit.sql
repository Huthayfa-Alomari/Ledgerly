-- Server-side per-user rate limiting for Ledgerly AI Copilot.
-- Apply this migration to staging before enabling LEDGERLY_AI_ENABLED.
create table if not exists public.ledgerly_ai_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.ledgerly_ai_rate_limits enable row level security;
revoke all on table public.ledgerly_ai_rate_limits from anon, authenticated, public;

create or replace function public.ledgerly_consume_ai_rate_limit(
  p_user_id uuid,
  p_limit integer default 10,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_allowed boolean;
begin
  if p_user_id is null or p_limit < 1 or p_limit > 100 or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'invalid rate-limit parameters';
  end if;

  insert into public.ledgerly_ai_rate_limits as current_limit
    (user_id, window_started_at, request_count, updated_at)
  values (p_user_id, now(), 1, now())
  on conflict (user_id) do update
    set window_started_at = case
          when now() >= current_limit.window_started_at + make_interval(secs => p_window_seconds) then now()
          else current_limit.window_started_at
        end,
        request_count = case
          when now() >= current_limit.window_started_at + make_interval(secs => p_window_seconds) then 1
          else current_limit.request_count + 1
        end,
        updated_at = now()
  returning request_count <= p_limit into v_allowed;

  return v_allowed;
end;
$$;

revoke all on function public.ledgerly_consume_ai_rate_limit(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.ledgerly_consume_ai_rate_limit(uuid, integer, integer) to service_role;
