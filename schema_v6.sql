-- Rewind Version 6: the public feed.
-- Run this ONCE in Supabase > SQL Editor. (schema.sql, schema_v3.sql and schema_v4.sql must already have been run.)

create table if not exists public.public_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  thumb_path text not null,
  caption text check (char_length(caption) <= 150),
  prompt text check (char_length(prompt) <= 80),
  song_title text check (char_length(song_title) <= 200),
  song_artist text check (char_length(song_artist) <= 200),
  song_art public.music_url,
  song_preview public.music_url,
  song_link public.music_url,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days')
);
create index if not exists public_posts_new_idx on public.public_posts (created_at desc);

create table if not exists public.reactions (
  post_id uuid not null references public.public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('love', 'shot', 'funny', 'nostalgic')),
  primary key (post_id, user_id, kind)
);
create table if not exists public.reports (
  post_id uuid not null references public.public_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

alter table public.public_posts enable row level security;
alter table public.reactions enable row level security;
alter table public.reports enable row level security;
revoke all on public.public_posts, public.reactions, public.reports from anon, authenticated;

-- You can peek at the public feed once you have posted something (to a group or publicly) in the last day.
create or replace function public.can_peek() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from posts where user_id = auth.uid() and created_at > now() - interval '1 day')
      or exists (select 1 from public_posts where user_id = auth.uid() and created_at > now() - interval '1 day');
$$;

create or replace function public.create_public_post(p_image text, p_thumb text, p_title text, p_artist text, p_art text,
                                                     p_preview text, p_link text, p_caption text, p_prompt text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; prefix text := 'public/' || auth.uid()::text || '/';
begin
  if auth.uid() is null or not exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'no account'; end if;
  if left(p_image, length(prefix)) <> prefix or left(p_thumb, length(prefix)) <> prefix then raise exception 'bad path'; end if;
  if (select count(*) from public_posts where user_id = auth.uid() and created_at > now() - interval '1 day') >= 3 then
    raise exception 'daily limit'; end if;
  insert into public_posts (user_id, image_path, thumb_path, song_title, song_artist, song_art, song_preview, song_link, caption, prompt)
  values (auth.uid(), p_image, p_thumb, p_title, p_artist, p_art, p_preview, p_link,
          nullif(left(trim(p_caption), 150), ''), nullif(left(trim(p_prompt), 80), ''))
  returning id into v_id;
  return v_id;
end $$;

-- The feed: the 20 newest photos, and then it ends.
create or replace function public.public_feed()
returns table (id uuid, nickname text, tag text, mine boolean, image_path text, thumb_path text,
               song_title text, song_artist text, song_art text, song_preview text, song_link text,
               caption text, prompt text, created_at timestamptz, expires_at timestamptz,
               love bigint, shot bigint, funny bigint, nostalgic bigint, mine_kinds text[])
language plpgsql security definer stable set search_path = public as $$
begin
  if not can_peek() then raise exception 'post to peek'; end if;
  return query
    select p.id, pr.nickname, pr.tag, (p.user_id = auth.uid()), p.image_path, p.thumb_path,
           p.song_title, p.song_artist, p.song_art::text, p.song_preview::text, p.song_link::text,
           p.caption, p.prompt, p.created_at, p.expires_at,
           (select count(*) from reactions r where r.post_id = p.id and r.kind = 'love'),
           (select count(*) from reactions r where r.post_id = p.id and r.kind = 'shot'),
           (select count(*) from reactions r where r.post_id = p.id and r.kind = 'funny'),
           (select count(*) from reactions r where r.post_id = p.id and r.kind = 'nostalgic'),
           coalesce((select array_agg(r.kind) from reactions r where r.post_id = p.id and r.user_id = auth.uid()), '{}')
    from public_posts p left join profiles pr on pr.user_id = p.user_id
    where not p.hidden and p.expires_at > now()
      and not exists (select 1 from reports rp where rp.post_id = p.id and rp.user_id = auth.uid())
    order by p.created_at desc limit 20;
end $$;

create or replace function public.react(p_post uuid, p_kind text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_peek() then raise exception 'post to peek'; end if;
  if p_kind not in ('love', 'shot', 'funny', 'nostalgic') then raise exception 'bad reaction'; end if;
  if not exists (select 1 from public_posts where id = p_post and not hidden and expires_at > now()) then raise exception 'gone'; end if;
  if exists (select 1 from reactions where post_id = p_post and user_id = auth.uid() and kind = p_kind) then
    delete from reactions where post_id = p_post and user_id = auth.uid() and kind = p_kind;
  else
    insert into reactions (post_id, user_id, kind) values (p_post, auth.uid(), p_kind);
  end if;
end $$;

-- Three different people reporting a photo hides it for everyone.
create or replace function public.report_post(p_post uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into reports (post_id, user_id, reason) values (p_post, auth.uid(), left(coalesce(p_reason, ''), 100)) on conflict do nothing;
  update public_posts set hidden = true where id = p_post and (select count(*) from reports where post_id = p_post) >= 3;
end $$;

create or replace function public.delete_public_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin delete from public_posts where id = p_post and user_id = auth.uid(); end $$;

create or replace function public.expired_public_paths() returns setof text
language sql security definer stable set search_path = public as $$
  select image_path from public_posts where expires_at <= now()
  union all select thumb_path from public_posts where expires_at <= now();
$$;

create or replace function public.purge_expired_public() returns void
language plpgsql security definer set search_path = public as $$
begin delete from public_posts where expires_at <= now(); end $$;

create or replace function public.is_expired_public_file(fname text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from public_posts p where (p.image_path = fname or p.thumb_path = fname) and p.expires_at <= now());
$$;

-- Account deletion should clear public photos too.
create or replace function public.my_file_paths() returns setof text
language sql security definer stable set search_path = public as $$
  select image_path from posts where user_id = auth.uid()
  union all select thumb_path from posts where user_id = auth.uid()
  union all select image_path from public_posts where user_id = auth.uid()
  union all select thumb_path from public_posts where user_id = auth.uid();
$$;

-- Photo storage rules. "public/..." files belong to the public feed; "<group id>/..." files belong to a group.
create or replace function public.group_of(fname text) returns uuid
language sql immutable as $$
  select case when split_part(fname, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then split_part(fname, '/', 1)::uuid else null end;
$$;

drop policy if exists "rewind members upload" on storage.objects;
drop policy if exists "rewind members read" on storage.objects;
drop policy if exists "rewind last member cleanup" on storage.objects;
create policy "rewind members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'rewind-photos' and public.is_member(public.group_of(name))
              and (storage.foldername(name))[2] = auth.uid()::text);
create policy "rewind members read" on storage.objects for select to authenticated
  using (bucket_id = 'rewind-photos' and public.is_member(public.group_of(name)));
create policy "rewind last member cleanup" on storage.objects for delete to authenticated
  using (bucket_id = 'rewind-photos' and public.is_last_member(public.group_of(name)));

drop policy if exists "rewind public upload" on storage.objects;
drop policy if exists "rewind public read" on storage.objects;
drop policy if exists "rewind public expired cleanup" on storage.objects;
create policy "rewind public upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'rewind-photos' and (storage.foldername(name))[1] = 'public'
              and (storage.foldername(name))[2] = auth.uid()::text);
create policy "rewind public read" on storage.objects for select to authenticated
  using (bucket_id = 'rewind-photos' and (storage.foldername(name))[1] = 'public' and public.can_peek());
create policy "rewind public expired cleanup" on storage.objects for delete to authenticated
  using (bucket_id = 'rewind-photos' and public.is_expired_public_file(name));

revoke all on function public.can_peek(), public.create_public_post(text, text, text, text, text, text, text, text, text),
  public.public_feed(), public.react(uuid, text), public.report_post(uuid, text), public.delete_public_post(uuid),
  public.expired_public_paths(), public.purge_expired_public(), public.is_expired_public_file(text), public.group_of(text)
  from public, anon;
grant execute on function public.can_peek(), public.create_public_post(text, text, text, text, text, text, text, text, text),
  public.public_feed(), public.react(uuid, text), public.report_post(uuid, text), public.delete_public_post(uuid),
  public.expired_public_paths(), public.purge_expired_public(), public.is_expired_public_file(text), public.group_of(text)
  to authenticated;

notify pgrst, 'reload schema';
