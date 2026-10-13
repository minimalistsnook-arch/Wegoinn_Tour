// @vitest-environment node
import { it } from "vitest";
import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import assert from 'node:assert/strict';
it("enforces operator permissions, preserves authors, and delivers community comments in PostgreSQL", async()=>{
const db=new PGlite();
try {
await db.exec(`create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid,name text,bucket_id text);create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;create publication supabase_realtime;grant usage on schema auth to authenticated;`);
await db.exec(fs.readFileSync(new URL('../supabase/schema.sql',import.meta.url),'utf8').replace('create extension if not exists pgcrypto;',''));

let serial=0;
async function login(admin,name,room='606'){
 const uid=`00000000-0000-0000-0000-${String(++serial).padStart(12,'0')}`;
 await db.query('insert into auth.users values($1)',[uid]);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid]);
 const p=(await db.query('select * from register_stay_guest($1,$2,$3,$4)',[admin?'999222':'2099-10-13',admin?'999222':'2099-10-25',admin?'':room,name])).rows[0];
 return {...p,uid};
}
async function as(p){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[p.uid]);await db.exec('set role authenticated');}
const guest=await login(false,'guest');const stranger=await login(false,'stranger');const admin=await login(true,'operator');
await as(guest);
await db.query('select touch_guest_session()');
await assert.rejects(db.query('select * from admin_account_roster()'),/Admin only/);
await assert.rejects(db.query('select admin_delete_account($1)',[stranger.id]),/Admin only/);
await assert.rejects(db.query('select * from guest_activity'),/permission denied/);
const post=(await db.query("insert into posts(content) values('original') returning id")).rows[0].id;
const postComment=(await db.query("insert into comments(post_id,content) values($1,'Original comment') returning id",[post])).rows[0].id;
const chat=(await db.query("insert into chat_messages(content) values('hello') returning id")).rows[0].id;
await assert.rejects(db.query("select admin_update_content('post',$1,'tampered',null,false)",[post]),/Admin only/);
await as(admin);
const roster=(await db.query('select * from admin_account_roster()')).rows;
assert.equal(roster.find(p=>p.id===guest.id).is_online,true);
assert.equal(roster.find(p=>p.id===guest.id).check_in,'2099-10-13');
assert.equal(roster.find(p=>p.id===admin.id).check_out,'999222');
await assert.rejects(db.query('select admin_delete_account($1)',[admin.id]),/현재 로그인/);
await as(guest);await db.query('select touch_guest_session(true)');await as(admin);
assert.equal((await db.query('select * from admin_account_roster()')).rows.find(p=>p.id===guest.id).is_online,false);
const community=(await db.query("select create_community_v2(null,$1::jsonb) id",[JSON.stringify({title:'Walk',activity:'Explore',preferred_participants:'All',schedule:'Plan',community_date:'2099-01-01',community_time:'19:00',max_participants:4,min_participants:1,participation_fee:0,meeting_place:'Lobby',map_url:'',language:'en',application_deadline:'2099-01-01T18:00'})])).rows[0].id;
await db.exec('reset role');await db.query('update communities set creator_id=$1,community_date=$2,application_deadline=null where id=$3',[guest.id,'2000-01-01',community]);
await as(guest);
assert.equal((await db.query('delete from communities where id=$1 returning id',[community])).rows.length,0);
await assert.rejects(db.query("select update_community($1,$2::jsonb)",[community,JSON.stringify({title:'forbidden'})]),/read-only/);
await as(admin);
await db.query("select admin_update_content('post',$1,'moderated',null,false)",[post]);
await db.query("select admin_update_content('comment',$1,'Moderated comment',null,false)",[postComment]);
assert.equal((await db.query('select author_id from comments where id=$1',[postComment])).rows[0].author_id,guest.id);
await assert.rejects(db.query("select admin_update_content('profiles',$1,'override',null,false)",[guest.id]),/Unsupported content type/);
await db.query("select admin_update_content('chat',$1,'edited chat',null,false)",[chat]);
assert.deepEqual((await db.query('select content,author_id from posts where id=$1',[post])).rows[0],{content:'moderated',author_id:guest.id});
await db.query("select update_community($1,$2::jsonb)",[community,JSON.stringify({title:'Corrected history',activity:'Explore',preferred_participants:'All',schedule:'Plan',community_date:'2000-01-01',community_time:'19:00',max_participants:4,min_participants:1,participation_fee:0,meeting_place:'Lobby',map_url:'',language:'en'})]);
const comment=(await db.query("insert into community_comments(community_id,content) values($1,'Operator feedback') returning id,is_operator",[community])).rows[0];assert.equal(comment.is_operator,true);
await as(guest);
assert.equal((await db.query("select count(*)::int n from notifications where kind='comment'")).rows[0].n,1);
await db.query("insert into community_comments(community_id,content) values($1,'Host reply')",[community]);
await assert.rejects(db.query("insert into community_comments(community_id,content,is_operator) values($1,'spoof',true)",[community]),/permission denied/);
await as(stranger);
assert.equal((await db.query('delete from posts where id=$1 returning id',[post])).rows.length,0);
assert.equal((await db.query('delete from chat_messages where id=$1 returning id',[chat])).rows.length,0);
await assert.rejects(db.query("update posts set content='override' where id=$1",[post]),/permission denied/);
await assert.rejects(db.query("insert into community_comments(community_id,content) values($1,'unrelated')",[community]),/row-level security/);
await as(admin);
assert.equal((await db.query("select count(*)::int n from notifications where kind='comment'")).rows[0].n,1);
await db.query('delete from communities where id=$1',[community]);
assert.equal((await db.query('select count(*)::int n from community_comments')).rows[0].n,0);
await db.query('delete from posts where id=$1',[post]);await db.query('delete from chat_messages where id=$1',[chat]);

await as(stranger);
const removedPost=(await db.query("insert into posts(content) values('delete with account') returning id")).rows[0].id;
await db.query('select touch_guest_session()');
await as(admin);await db.query('select admin_delete_account($1)',[stranger.id]);
assert.equal((await db.query('select * from admin_account_roster()')).rows.some(p=>p.id===stranger.id),false);
assert.equal((await db.query('select id from posts where id=$1',[removedPost])).rows.length,0);
await as(stranger);assert.equal((await db.query('select current_profile_id() id')).rows[0].id,null);
await assert.rejects(db.query("insert into posts(content) values('revoked')"),/row-level security/);
} finally { await db.close(); }

},20000);
