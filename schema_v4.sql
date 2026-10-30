-- Rewind Version 4: photo expiry clean-up, daily prompts on posts, and expiry dates in the feed.
-- Run this ONCE in Supabase > SQL Editor. (schema.sql and schema_v3.sql must already have been run. Do not run schema_v3.sql again.)

alter table public.posts add column if not exists prompt text check (char_length(prompt) <= 80);
-- New photos now stay for 60 days, so last month's album is still complete.
alter table public.posts alter column expires_at set default (now() + interval '60 days');

drop function if exists public.group_feed(uuid);
create or replace function public.group_feed(p_group uuid)
returns table (id uuid, nickname text, tag text, mine boolean, image_path text, thumb_path text,
               song_title text, song_artist text, song_art text, song_preview text, song_link text,
               created_at timestamptz, caption text, prompt text, expires_at timestamptz)
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  return query
    select p.id, pr.nickname, pr.tag, (p.user_id = auth.uid()), p.image_path, p.thumb_path,
           p.song_title, p.song_artist, p.song_art::text, p.song_preview::text, p.song_link::text,
           p.created_at, p.caption, p.prompt, p.expires_at
    from posts p left join profiles pr on pr.user_id = p.user_id
    where p.group_id = p_group and p.expires_at > now()
    order by p.created_at desc limit 200;
end $$;

drop function if exists public.create_post(uuid, text, text, text, text, text, text, text, text);
drop function if exists public.create_post(uuid, text, text, text, text, text, text, text, text, text);
create or replace function public.create_post(p_group uuid, p_image text, p_thumb text, p_title text, p_artist text,
                                              p_art text, p_preview text, p_link text, p_caption text, p_prompt text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; prefix text := p_group::text || '/' || auth.uid()::text || '/';
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  if left(p_image, length(prefix)) <> prefix or left(p_thumb, length(prefix)) <> prefix then raise exception 'bad path'; end if;
  if (select count(*) from posts where user_id = auth.uid() and created_at > now() - interval '1 day') >= 10 then
    raise exception 'daily limit'; end if;
  insert into posts (group_id, user_id, image_path, thumb_path, song_title, song_artist, song_art, song_preview, song_link, caption, prompt)
  values (p_group, auth.uid(), p_image, p_thumb, p_title, p_artist, p_art, p_preview, p_link,
          nullif(left(trim(p_caption), 150), ''), nullif(left(trim(p_prompt), 80), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Clean-up: any member's phone can sweep out expired photos when the group is opened.
create or replace function public.expired_paths(p_group uuid) returns setof text
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  return query select image_path from posts where group_id = p_group and expires_at <= now()
               union all select thumb_path from posts where group_id = p_group and expires_at <= now();
end $$;

create or replace function public.purge_expired(p_group uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_member(p_group) then raise exception 'not a member'; end if;
  delete from posts where group_id = p_group and expires_at <= now();
end $$;

create or replace function public.is_expired_file(fname text) returns boolean
language sql security definer stable set search_path = public as $$
  select exists (select 1 from posts p
                 where (p.image_path = fname or p.thumb_path = fname) and p.expires_at <= now() and is_member(p.group_id));
$$;

drop policy if exists "rewind expired cleanup" on storage.objects;
create policy "rewind expired cleanup" on storage.objects for delete to authenticated
  using (bucket_id = 'rewind-photos' and public.is_expired_file(name));

revoke all on function public.group_feed(uuid),
  public.create_post(uuid, text, text, text, text, text, text, text, text, text),
  public.expired_paths(uuid), public.purge_expired(uuid), public.is_expired_file(text) from public, anon;
grant execute on function public.group_feed(uuid),
  public.create_post(uuid, text, text, text, text, text, text, text, text, text),
  public.expired_paths(uuid), public.purge_expired(uuid), public.is_expired_file(text) to authenticated;

notify pgrst, 'reload schema';
