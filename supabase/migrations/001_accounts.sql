-- Honey Charts accounts, phase 1.
-- Safe to run more than once. Paste this whole file into the Supabase SQL Editor and press Run.
-- Do not put a secret server key in this file.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text,
  display_name text,
  avatar_url text,
  bio text,
  website text,
  x_handle text,
  telegram text,
  solana_address text,
  profile_song_url text,
  profile_song_title text,
  hive_public boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists display_name text;
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists bio text;
alter table public.profiles add column if not exists website text;
alter table public.profiles add column if not exists x_handle text;
alter table public.profiles add column if not exists telegram text;
alter table public.profiles add column if not exists solana_address text;
alter table public.profiles add column if not exists profile_song_url text;
alter table public.profiles add column if not exists profile_song_title text;
alter table public.profiles add column if not exists hive_public boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz not null default now();

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format
  check (username is null or username ~ '^[a-z][a-z0-9_]{2,19}$');

alter table public.profiles drop constraint if exists profiles_username_reserved;
alter table public.profiles add constraint profiles_username_reserved
  check (username is null or username not in (
    'admin', 'administrator', 'api', 'everyone', 'help', 'hive', 'honey', 'honeycharts',
    'launch', 'moderator', 'null', 'official', 'owner', 'root', 'security', 'staff',
    'support', 'system', 'undefined', 'wallet', 'www'
  ));

alter table public.profiles drop constraint if exists profiles_display_name_len;
alter table public.profiles add constraint profiles_display_name_len
  check (display_name is null or char_length(display_name) <= 40);

alter table public.profiles drop constraint if exists profiles_bio_len;
alter table public.profiles add constraint profiles_bio_len
  check (bio is null or char_length(bio) <= 280);

alter table public.profiles drop constraint if exists profiles_website_len;
alter table public.profiles add constraint profiles_website_len
  check (website is null or (char_length(website) <= 200 and website ~ '^https://'));

alter table public.profiles drop constraint if exists profiles_song_len;
alter table public.profiles add constraint profiles_song_len
  check (profile_song_url is null or char_length(profile_song_url) <= 500);

alter table public.profiles drop constraint if exists profiles_song_title_len;
alter table public.profiles add constraint profiles_song_title_len
  check (profile_song_title is null or char_length(profile_song_title) <= 80);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username))
  where username is not null;

create table if not exists public.hive_items (
  user_id uuid not null references auth.users (id) on delete cascade,
  mint text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, mint)
);

alter table public.hive_items drop constraint if exists hive_items_mint_format;
alter table public.hive_items add constraint hive_items_mint_format
  check (mint ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$');

create table if not exists public.follows (
  follower_id uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);

create index if not exists follows_following_idx on public.follows (following_id);

alter table public.profiles enable row level security;
alter table public.hive_items enable row level security;
alter table public.follows enable row level security;

drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to anon, authenticated
  using (true);

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (auth.uid() = id);

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists hive_items_select on public.hive_items;
create policy hive_items_select on public.hive_items
  for select to anon, authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.profiles
      where profiles.id = hive_items.user_id
        and profiles.hive_public is true
    )
  );

drop policy if exists hive_items_insert on public.hive_items;
create policy hive_items_insert on public.hive_items
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists hive_items_update on public.hive_items;
create policy hive_items_update on public.hive_items
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists hive_items_delete on public.hive_items;
create policy hive_items_delete on public.hive_items
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists follows_select on public.follows;
create policy follows_select on public.follows
  for select to anon, authenticated
  using (true);

drop policy if exists follows_insert on public.follows;
create policy follows_insert on public.follows
  for insert to authenticated
  with check (auth.uid() = follower_id);

drop policy if exists follows_delete on public.follows;
create policy follows_delete on public.follows
  for delete to authenticated
  using (auth.uid() = follower_id);

grant select on table public.profiles to anon, authenticated;
grant insert, update on table public.profiles to authenticated;
grant select on table public.hive_items to anon, authenticated;
grant insert, update, delete on table public.hive_items to authenticated;
grant select on table public.follows to anon, authenticated;
grant insert, delete on table public.follows to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
grant execute on function public.handle_new_user() to supabase_auth_admin;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

update storage.buckets
set
  file_size_limit = 2097152,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id = 'avatars';

drop policy if exists avatars_public_read on storage.objects;
create policy avatars_public_read on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'avatars');

drop policy if exists avatars_owner_insert on storage.objects;
create policy avatars_owner_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists avatars_owner_update on storage.objects;
create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists avatars_owner_delete on storage.objects;
create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
