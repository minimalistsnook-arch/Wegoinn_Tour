// @vitest-environment node
import { expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
it('enforces consent in DB access, records versions, and restricts notice editing to admins', async () => {
 const db = new PGlite();
 try {
 await db.exec(`
 create role anon; create role authenticated;
 create schema auth; create schema storage;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.guest_uid',true),'')::uuid$$;
 create table public.profiles(id uuid primary key,auth_user_id uuid,nickname text,role text,check_in date,check_out date,room_number text,reservation_number text,avatar_url text,stay_ended_at timestamptz);
 create table public.guest_sessions(auth_user_id uuid primary key,profile_id uuid);
 create table public.hostel_rooms(room_number text primary key,room_type text,capacity int);
 create table storage.objects(name text,bucket_id text);
 alter table storage.objects enable row level security;
 grant usage on schema storage to authenticated;
 grant insert on storage.objects to authenticated;
 alter table profiles enable row level security;
 grant select on profiles to authenticated;
 create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
 create function public.stay_is_active(p public.profiles) returns boolean language sql stable as $$select p.stay_ended_at is null and (p.role='admin' or p.check_out>=current_date)$$;
 create function public.current_profile_id() returns uuid language sql stable security definer set search_path=public as $$select id from profiles where auth_user_id=auth.uid()$$;
 create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$select exists(select 1 from profiles where id=current_profile_id() and role='admin')$$;
 create policy profiles_access on profiles for select to authenticated using ((select current_profile_id()) is not null);
 insert into public.profiles(id,auth_user_id,nickname,role,check_in,check_out) values
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000011','Guest','guest','2026-01-01','2099-12-31'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000022','Admin','admin',null,null);
 create table posts(id serial primary key,content text);
 alter table posts enable row level security;
 create policy posts_access on posts for all to authenticated using ((select current_profile_id()) is not null) with check ((select current_profile_id()) is not null);
 grant select,insert on posts to authenticated;
 grant usage,select on sequence posts_id_seq to authenticated;
 insert into posts(content) values('Protected content');
 `);
 const migration = readFileSync(`${process.cwd()}/wegoinn/supabase/migrations/20261015_community_consent.sql`, 'utf8');
 await db.exec(migration);
 await db.exec("set test.guest_uid='00000000-0000-0000-0000-000000000011'; set role authenticated;");
 expect((await db.query('select current_profile_id() as id')).rows[0].id).toBeNull();
 expect((await db.query('select * from posts')).rows).toHaveLength(0);
 expect((await db.query('select * from get_my_profile()')).rows[0].nickname).toBe('Guest');
 expect((await db.query('select * from get_my_stay()')).rows[0].check_out).toBe('2099-12-31');
 const state = (await db.query('select get_community_terms() as data')).rows[0].data;
 expect(state.accepted).toBe(false);
 expect((await db.query('select * from profiles')).rows).toHaveLength(1);
 await db.query('select set_my_avatar($1)', ['https://example.supabase.co/storage/v1/object/public/post-images/00000000-0000-0000-0000-000000000011/avatar.webp']);
 await db.exec("insert into storage.objects(bucket_id,name) values('post-images','00000000-0000-0000-0000-000000000011/avatar.webp')");
 expect(state.body).toContain('Wegoinnteam@gmail.com');
 await expect(db.exec("insert into posts(content) values('Bypass')")).rejects.toThrow();
 await expect(db.query('select accept_community_terms($1)', [state.version+1])).rejects.toThrow();
 await expect(db.query('select publish_community_terms($1,$2)', ['x'.repeat(200),state.version])).rejects.toThrow('운영자');
 await db.query('select accept_community_terms($1)', [state.version]);
 expect((await db.query('select * from posts')).rows).toHaveLength(1);
 expect((await db.query('select current_profile_id() as id')).rows[0].id).not.toBeNull();
 await db.exec("set test.guest_uid='00000000-0000-0000-0000-000000000022'");
 const v2=(await db.query('select publish_community_terms($1,$2) as version',['New terms. '.repeat(20),state.version])).rows[0].version;
 await expect(db.query('select publish_community_terms($1,$2)',['Other edit. '.repeat(20),state.version])).rejects.toThrow('다른 운영자');
 await db.exec("set test.guest_uid='00000000-0000-0000-0000-000000000011'");
 expect((await db.query('select * from posts')).rows).toHaveLength(0);
 expect((await db.query('select get_community_terms() as data')).rows[0].data.accepted).toBe(false);
 await expect(db.query('select accept_community_terms($1)',[state.version])).rejects.toThrow('변경');
 await db.query('select accept_community_terms($1)',[v2]);
 await db.query('select accept_community_terms($1)',[v2]);
 expect((await db.query('select * from posts')).rows).toHaveLength(1);
 await expect(db.exec('select * from community_terms_acceptances')).rejects.toThrow();
 await db.exec('reset role');
 expect((await db.query('select * from community_terms_acceptances')).rows).toHaveLength(2);
 await db.exec(migration); // Re-running deployment preserves the edited version and consent history.
 expect((await db.query('select count(*)::int as n from community_terms_versions')).rows[0].n).toBe(2);
 await db.exec("update profiles set stay_ended_at=now() where role='guest'");
 expect((await db.query('select current_profile_id() as id')).rows[0].id).toBeNull();
 await expect(db.query('select accept_community_terms($1)',[v2])).rejects.toThrow('Not signed in');
 } finally { await db.close(); }
}, 30000);
