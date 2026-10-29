-- Flashback Version 2: accounts. Paste this whole file into Supabase > SQL Editor and press Run.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  nickname text not null check (nickname ~ '^[A-Za-z0-9 _-]{2,20}$'),
  tag text not null,
  recovery_hash text not null,
  created_at timestamptz not null default now(),
  unique (nickname, tag)
);

alter table public.profiles enable row level security;

drop policy if exists "read own profile" on public.profiles;
create policy "read own profile" on public.profiles
  for select to authenticated using (user_id = auth.uid());

-- Nobody can touch the table directly; the recovery hash is never readable.
revoke all on public.profiles from anon, authenticated;
grant select (id, user_id, nickname, tag, created_at) on public.profiles to authenticated;

-- Make an account: nickname + a random 4-digit tag, and store only a hash of the recovery secret.
create or replace function public.create_profile(p_nickname text, p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_tag text; v_tries int := 0;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'already has a profile'; end if;
  if length(p_secret) < 20 then raise exception 'bad secret'; end if;
  loop
    v_tag := lpad((floor(random() * 10000))::int::text, 4, '0');
    begin
      insert into profiles (user_id, nickname, tag, recovery_hash)
      values (auth.uid(), trim(p_nickname), v_tag, encode(digest(p_secret, 'sha256'), 'hex'));
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries > 20 then raise exception 'try another nickname'; end if;
    end;
  end loop;
  return jsonb_build_object('nickname', trim(p_nickname), 'tag', v_tag);
end $$;

-- Get an account back: move it to this browser's new session if the secret matches.
create or replace function public.recover_profile(p_secret text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r profiles; h text := encode(digest(p_secret, 'sha256'), 'hex');
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- drop an empty account this browser made by accident, but never the one being recovered
  delete from profiles where user_id = auth.uid() and recovery_hash <> h;
  update profiles set user_id = auth.uid() where recovery_hash = h returning * into r;
  if r.id is null then raise exception 'no match'; end if;
  return jsonb_build_object('nickname', r.nickname, 'tag', r.tag);
end $$;

-- Make a new recovery link (the old one stops working).
create or replace function public.regenerate_recovery(p_secret text)
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if length(p_secret) < 20 then raise exception 'bad secret'; end if;
  update profiles set recovery_hash = encode(digest(p_secret, 'sha256'), 'hex') where user_id = auth.uid();
  if not found then raise exception 'no profile'; end if;
end $$;

revoke all on function public.create_profile(text, text), public.recover_profile(text), public.regenerate_recovery(text) from public, anon;
grant execute on function public.create_profile(text, text), public.recover_profile(text), public.regenerate_recovery(text) to authenticated;
