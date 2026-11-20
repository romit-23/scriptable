-- pvtshiiiiii v2: verified key exchange + encrypted media.
-- Run AFTER the original setup SQL. Paste into Supabase SQL Editor and click Run. Safe to run twice.
--
-- What it adds
--   1. public.handshakes   one public key per member per space (ECDH P-256). Public keys are not secret;
--                          clients authenticate them with the invite fingerprint/HMAC and safety numbers.
--   2. publish_key()       the only way to write a handshake row (members only, own row only).
--   3. storage bucket      "pvt-media", private, 50 MB per object, ciphertext only (application/octet-stream).
--   4. storage policies    members of a space can read/upload files under "<space_id>/...";
--                          the uploader can delete anytime, the partner only after 24h (expired cleanup).
--
-- Cost note: Storage and egress count against your Supabase plan. Every photo/video/voice note is
-- downloaded once per viewing phone. The app deletes expired files it can see; see the bottom of this file.

-- ---------- 1. Handshakes ----------
create table if not exists public.handshakes (
  space_id   uuid not null references public.spaces on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users on delete cascade,
  payload    text not null check (length(payload) <= 2000),
  updated_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

alter table public.handshakes enable row level security;
grant select on public.handshakes to authenticated;

drop policy if exists "members read handshakes" on public.handshakes;
create policy "members read handshakes" on public.handshakes
  for select to authenticated using (public.is_member(space_id));

-- No insert/update grants: writes go through this function only.
create or replace function public.publish_key(p_space uuid, p_payload text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if not public.is_member(p_space) then raise exception 'not a member'; end if;
  if p_payload is null or length(p_payload) > 2000 then raise exception 'invalid key payload'; end if;
  insert into public.handshakes (space_id, user_id, payload)
    values (p_space, auth.uid(), p_payload)
    on conflict (space_id, user_id) do update set payload = excluded.payload, updated_at = now();
end $$;

revoke all on function public.publish_key(uuid, text) from public, anon;
grant execute on function public.publish_key(uuid, text) to authenticated;

-- ---------- 2. Encrypted media bucket ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pvt-media', 'pvt-media', false, 52428800, array['application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Object names look like "<space_id>/<random>". A non-uuid folder simply fails the check.
create or replace function public.is_member_path(p_name text) returns boolean
language plpgsql security definer stable set search_path = public as $$
declare sid uuid;
begin
  begin
    sid := split_part(p_name, '/', 1)::uuid;
  exception when others then
    return false;
  end;
  return exists (select 1 from public.members where space_id = sid and user_id = auth.uid());
end $$;

revoke all on function public.is_member_path(text) from public, anon;
grant execute on function public.is_member_path(text) to authenticated;

drop policy if exists "pvt media read"   on storage.objects;
drop policy if exists "pvt media upload" on storage.objects;
drop policy if exists "pvt media delete" on storage.objects;

create policy "pvt media read" on storage.objects
  for select to authenticated
  using (bucket_id = 'pvt-media' and public.is_member_path(name));

create policy "pvt media upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'pvt-media' and public.is_member_path(name));

create policy "pvt media delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'pvt-media'
    and public.is_member_path(name)
    and (owner_id = (select auth.uid())::text or created_at < now() - interval '24 hours')
  );

-- ---------- 3. Expiry ----------
-- Message rows: the original setup already hides expired rows; enable its optional pg_cron purge.
-- Media files: do NOT delete from storage.objects with SQL (that orphans the underlying file).
-- The app deletes expired files in its space each time it opens. For guaranteed cleanup when
-- neither phone opens the app, add a scheduled Edge Function that calls the Storage API.
