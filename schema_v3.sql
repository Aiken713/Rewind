-- Rewind Version 3: friend groups, posts, and private photo storage.
-- Paste this whole file into Supabase > SQL Editor and press Run. (Version 2's schema.sql must already be run.)

do $$ begin
  create domain public.music_url as text
    check (value ~ '^https://([a-z0-9-]+\.)*(mzstatic\.com|apple\.com|dzcdn\.net|deezer\.com)/');
exception when duplicate_object then null; end $$;

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 30),
  code text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  image_path text not null,
  thumb_path text not null,
  song_title text check (char_length(song_title) <= 200),
  song_artist text check (char_length(song_artist) <= 200),
  song_art public.music_url,
  song_preview public.music_url,
  song_link public.music_url,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists posts_group_idx on public.posts (group_id, created_at desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.posts enable row level security;
-- Nobody touches these tables directly. Everything goes through the functions below.
revoke all on public.groups, public.group_members, public.posts from anon, authenticated;

create or replace function public.is_member(gid uuid) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from group_members where group_id = gid and user_id = auth.uid());
$$;

create or replace function public.create_group(p_name text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_id uuid; chars text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; i int;
begin
  if auth.uid() is null or not exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'no account'; end if;
  if (select count(*) from group_members where user_id = auth.uid()) >= 5 then raise exception 'too many groups'; end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(chars, 1 + (get_byte(gen_random_bytes(1), 0) % length(chars)), 1);
    end loop;
    exit when not exists (select 1 from groups where code = v_code);
  end loop;
  insert into groups (name, code, owner_id) values (trim(p_name), v_code, auth.uid()) returning id into v_id;
  insert into group_members (group_id, user_id) values (v_id, auth.uid());
  return jsonb_build_object('id', v_id, 'name', trim(p_name), 'code', v_code);
end $$;

create or replace function public.join_group(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null or not exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'no account'; end if;
  select * into g from groups where code = upper(trim(p_code));
  if g.id is null then raise exception 'no such group'; end if;
  if not exists (select 1 from group_members where group_id = g.id and user_id = auth.uid()) then
    if (select count(*) from group_members where group_id = g.id) >= 10 then raise exception 'group full'; end if;
    if (select count(*) from group_members where user_id = auth.uid()) >= 5 then raise exception 'too many groups'; end if;
    insert into group_members (group_id, user_id) values (g.id, auth.uid());
  end if;
  return jsonb_build_object('id', g.id, 'name', g.name, 'code', g.code);
end $$;

create or replace function public.my_groups()
returns table (id uuid, name text, code text, members bigint)
language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.code, (select count(*) from group_members m2 where m2.group_id = g.id)
  from groups g join group_members m on m.group_id = g.id and m.user_id = auth.uid()
  order by g.created_at;
$$;

create or replace function public.group_feed(p_group uuid)
returns table (id uuid, nickname text, tag text, mine boolean, image_path text, thumb_path text,
               song_title text, song_artist text, song_art text, song_preview text, song_link text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  return query
    select p.id, pr.nickname, pr.tag, (p.user_id = auth.uid()), p.image_path, p.thumb_path,
           p.song_title, p.song_artist, p.song_art::text, p.song_preview::text, p.song_link::text, p.created_at
    from posts p left join profiles pr on pr.user_id = p.user_id
    where p.group_id = p_group and p.expires_at > now()
    order by p.created_at desc limit 200;
end $$;

create or replace function public.create_post(p_group uuid, p_image text, p_thumb text, p_title text,
                                              p_artist text, p_art text, p_preview text, p_link text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; prefix text := p_group::text || '/' || auth.uid()::text || '/';
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  if left(p_image, length(prefix)) <> prefix or left(p_thumb, length(prefix)) <> prefix then raise exception 'bad path'; end if;
  if (select count(*) from posts where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'daily limit'; end if;
  insert into posts (group_id, user_id, image_path, thumb_path, song_title, song_artist, song_art, song_preview, song_link)
  values (p_group, auth.uid(), p_image, p_thumb, p_title, p_artist, p_art, p_preview, p_link) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_post(p_post uuid) returns void
language plpgsql security definer set search_path = public as $$
begin delete from posts where id = p_post and user_id = auth.uid(); end $$;

create or replace function public.leave_group(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from group_members where group_id = p_group and user_id = auth.uid();
  if not exists (select 1 from group_members where group_id = p_group) then delete from groups where id = p_group; end if;
end $$;

revoke all on function public.is_member(uuid), public.create_group(text), public.join_group(text), public.my_groups(),
  public.group_feed(uuid), public.create_post(uuid, text, text, text, text, text, text, text),
  public.delete_post(uuid), public.leave_group(uuid) from public, anon;
grant execute on function public.is_member(uuid), public.create_group(text), public.join_group(text), public.my_groups(),
  public.group_feed(uuid), public.create_post(uuid, text, text, text, text, text, text, text),
  public.delete_post(uuid), public.leave_group(uuid) to authenticated;

-- Private photo bucket: JPEG only, 1 MB each. Only group members can see a group's photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rewind-photos', 'rewind-photos', false, 1048576, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 1048576, allowed_mime_types = array['image/jpeg'];

drop policy if exists "rewind members upload" on storage.objects;
drop policy if exists "rewind members read" on storage.objects;
drop policy if exists "rewind owners delete" on storage.objects;
create policy "rewind members upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'rewind-photos' and public.is_member(((storage.foldername(name))[1])::uuid)
              and (storage.foldername(name))[2] = auth.uid()::text);
create policy "rewind members read" on storage.objects for select to authenticated
  using (bucket_id = 'rewind-photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "rewind owners delete" on storage.objects for delete to authenticated
  using (bucket_id = 'rewind-photos' and (storage.foldername(name))[2] = auth.uid()::text);
