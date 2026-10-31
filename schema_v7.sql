-- Rewind Version 7: postcards.
-- Run this ONCE in Supabase > SQL Editor. (The earlier SQL files must already have been run.)

alter table public.profiles add column if not exists postcards_from text not null default 'groups'
  check (postcards_from in ('everyone', 'groups', 'nobody'));

create table if not exists public.postcards (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  post_kind text not null check (post_kind in ('group', 'public')),
  post_id uuid not null,
  thumb_path text,
  note text not null check (char_length(note) between 1 and 100),
  stamp smallint not null default 0 check (stamp between 0 and 5),
  created_at timestamptz not null default now(),
  deliver_at timestamptz not null,
  read_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (sender_id, post_kind, post_id)
);
create index if not exists postcards_inbox_idx on public.postcards (recipient_id, deliver_at desc);

create table if not exists public.blocks (
  blocker_id uuid not null references auth.users(id) on delete cascade,
  blocked_id uuid not null references auth.users(id) on delete cascade,
  primary key (blocker_id, blocked_id)
);
-- Reports are for you to read in the Supabase Table Editor.
create table if not exists public.postcard_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete set null,
  note text,
  created_at timestamptz not null default now()
);

alter table public.postcards enable row level security;
alter table public.blocks enable row level security;
alter table public.postcard_reports enable row level security;
revoke all on public.postcards, public.blocks, public.postcard_reports from anon, authenticated;

create or replace function public.my_postcard_setting() returns text
language sql security definer stable set search_path = public as $$
  select postcards_from from profiles where user_id = auth.uid();
$$;

create or replace function public.set_postcard_setting(p_value text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_value not in ('everyone', 'groups', 'nobody') then raise exception 'bad value'; end if;
  update profiles set postcards_from = p_value where user_id = auth.uid();
end $$;

create or replace function public.send_postcard(p_kind text, p_post uuid, p_note text, p_stamp int) returns void
language plpgsql security definer set search_path = public as $$
declare v_to uuid; v_thumb text; v_setting text; v_note text := trim(coalesce(p_note, '')); v_stamp int := coalesce(p_stamp, 0);
begin
  if auth.uid() is null or not exists (select 1 from profiles where user_id = auth.uid()) then raise exception 'no account'; end if;
  if char_length(v_note) < 1 or char_length(v_note) > 100 then raise exception 'bad note'; end if;
  if v_note ~* '(https?://|www\.)' then raise exception 'links'; end if;
  if v_stamp < 0 or v_stamp > 5 then v_stamp := 0; end if;

  if p_kind = 'group' then
    select p.user_id, p.thumb_path into v_to, v_thumb from posts p
      where p.id = p_post and p.expires_at > now() and is_member(p.group_id);
  elsif p_kind = 'public' then
    select p.user_id, p.thumb_path into v_to, v_thumb from public_posts p
      where p.id = p_post and not p.hidden and p.expires_at > now() and can_peek();
  else
    raise exception 'bad kind';
  end if;
  if v_to is null then raise exception 'gone'; end if;
  if v_to = auth.uid() then raise exception 'yourself'; end if;

  if exists (select 1 from blocks where blocker_id = v_to and blocked_id = auth.uid()) then raise exception 'not accepting'; end if;
  select coalesce(postcards_from, 'groups') into v_setting from profiles where user_id = v_to;
  if v_setting = 'nobody' then raise exception 'not accepting'; end if;
  if v_setting = 'groups' and not exists (
       select 1 from group_members a join group_members b on a.group_id = b.group_id
       where a.user_id = auth.uid() and b.user_id = v_to) then raise exception 'not accepting'; end if;
  if (select count(*) from postcards where sender_id = auth.uid() and created_at > now() - interval '1 day') >= 3 then
    raise exception 'daily limit'; end if;

  begin
    insert into postcards (sender_id, recipient_id, post_kind, post_id, thumb_path, note, stamp, deliver_at)
    values (auth.uid(), v_to, p_kind, p_post, v_thumb, v_note, v_stamp,
            now() + ((60 + floor(random() * 180))::int * interval '1 minute'));   -- arrives 1 to 4 hours later
  exception when unique_violation then
    raise exception 'already sent';
  end;
end $$;

create or replace function public.my_mailbox()
returns table (id uuid, nickname text, tag text, note text, stamp smallint, thumb_path text, deliver_at timestamptz, read_at timestamptz)
language sql security definer stable set search_path = public as $$
  select c.id, pr.nickname, pr.tag, c.note, c.stamp, c.thumb_path, c.deliver_at, c.read_at
  from postcards c left join profiles pr on pr.user_id = c.sender_id
  where c.recipient_id = auth.uid() and c.deliver_at <= now() and c.expires_at > now()
    and not exists (select 1 from blocks b where b.blocker_id = auth.uid() and b.blocked_id = c.sender_id)
  order by c.deliver_at desc limit 100;
$$;

create or replace function public.mailbox_count() returns bigint
language sql security definer stable set search_path = public as $$
  select count(*) from postcards c
  where c.recipient_id = auth.uid() and c.deliver_at <= now() and c.expires_at > now() and c.read_at is null
    and not exists (select 1 from blocks b where b.blocker_id = auth.uid() and b.blocked_id = c.sender_id);
$$;

create or replace function public.mark_postcards_read() returns void
language plpgsql security definer set search_path = public as $$
begin update postcards set read_at = now() where recipient_id = auth.uid() and read_at is null and deliver_at <= now(); end $$;

create or replace function public.delete_postcard(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin delete from postcards where id = p_id and recipient_id = auth.uid(); end $$;

-- Reports the postcard (so you can read it) and blocks that sender from now on.
create or replace function public.report_and_block(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare c postcards;
begin
  select * into c from postcards where id = p_id and recipient_id = auth.uid();
  if c.id is null then raise exception 'gone'; end if;
  insert into postcard_reports (reporter_id, sender_id, note) values (auth.uid(), c.sender_id, c.note);
  insert into blocks (blocker_id, blocked_id) values (auth.uid(), c.sender_id) on conflict do nothing;
  delete from postcards where id = p_id;
end $$;

create or replace function public.purge_old_postcards() returns void
language plpgsql security definer set search_path = public as $$
begin delete from postcards where expires_at <= now(); end $$;

-- You can always see your own photo files (so a postcard can show the photo it is about).
drop policy if exists "rewind owners read" on storage.objects;
create policy "rewind owners read" on storage.objects for select to authenticated
  using (bucket_id = 'rewind-photos' and (storage.foldername(name))[2] = auth.uid()::text);

revoke all on function public.my_postcard_setting(), public.set_postcard_setting(text), public.send_postcard(text, uuid, text, int),
  public.my_mailbox(), public.mailbox_count(), public.mark_postcards_read(), public.delete_postcard(uuid),
  public.report_and_block(uuid), public.purge_old_postcards() from public, anon;
grant execute on function public.my_postcard_setting(), public.set_postcard_setting(text), public.send_postcard(text, uuid, text, int),
  public.my_mailbox(), public.mailbox_count(), public.mark_postcards_read(), public.delete_postcard(uuid),
  public.report_and_block(uuid), public.purge_old_postcards() to authenticated;

notify pgrst, 'reload schema';
