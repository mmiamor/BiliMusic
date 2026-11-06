import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import { once } from 'node:events';
import { mkdtempSync, existsSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync } from 'node:crypto';
import { createDatabase, MusicDatabase } from '../database.mjs';
import { createHandler, databaseOptionsFromEnv } from '../server.mjs';

const origin='https://music.example.org', fixturePassword='isolated-test-password';
async function call(handler,route,{body={},method='POST',cookie='',headers={},ip='127.0.0.1',bodyGate}={}) {
  const data=Buffer.from(typeof body==='string'?body:JSON.stringify(body));
  const req=Readable.from(bodyGate?(async function*(){await bodyGate();yield data;})():[data]);
  req.method=method;req.url=route;req.headers={host:'music.example.org',origin,'content-type':'application/json',cookie,...headers};req.socket={remoteAddress:ip};
  const chunks=[],out=new Map();let status=200;
  const res=new Writable({write(chunk,enc,done){chunks.push(Buffer.from(chunk));done();}});
  res.setHeader=(key,value)=>out.set(key.toLowerCase(),value);res.writeHead=(code,fields)=>{status=code;res.headersSent=true;for(const [key,value]of Object.entries(fields||{}))res.setHeader(key,value);};
  const finished=once(res,'finish');await handler(req,res);await finished;
  const text=Buffer.concat(chunks).toString(),cookies=out.get('set-cookie');
  return {status,text,value:String(out.get('content-type')).includes('json')?JSON.parse(text):null,cookies:Array.isArray(cookies)?cookies:cookies?[cookies]:[],headers:out};
}
function jar(result,previous='') {
  const map=new Map(previous.split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const at=x.indexOf('=');return [x.slice(0,at),x.slice(at+1)];}));
  for(const cookie of result.cookies) {const [pair]=cookie.split(';'),at=pair.indexOf('=');if(/Max-Age=0(?:;|$)/.test(cookie))map.delete(pair.slice(0,at));else map.set(pair.slice(0,at),pair.slice(at+1));}
  return [...map].map(([key,value])=>key+'='+value).join('; ');
}
async function fixture(t,fetcher) {
  const db=await createDatabase({adminPassword:fixturePassword});t.after(()=>db.close());
  const handler=createHandler({publicOrigin:origin,database:db,...(fetcher?{fetcher}:{})});
  const login=await call(handler,'/api/auth/login',{body:{username:'Music',password:fixturePassword}});
  assert.equal(login.status,200);return {db,handler,admin:jar(login),login};
}
const song=id=>({source:'kuwo',id:'kuwo:'+id,rid:String(id),title:'曲目 '+id,artist:'测试歌手',duration:120,cover:''});

test('first startup requires a password; SQLite persists hashed credentials, revocable hashed sessions and playlists',async t=>{
  await assert.rejects(createDatabase(),{status:503});
  const directory=mkdtempSync(path.join(tmpdir(),'bilimusic-db-test-')),filename=path.join(directory,'state.sqlite');
  t.after(()=>{for(const suffix of ['', '-wal','-shm'])if(existsSync(filename+suffix))unlinkSync(filename+suffix);rmdirSync(directory);});
  let db=await createDatabase({filename,adminPassword:fixturePassword});
  const login=await db.login('music',fixturePassword),p=db.createPlaylist(login.user.id,{name:'持久歌单'});
  db.addTracks(login.user.id,p.id,[song(42)]);db.close();
  const raw=new DatabaseSync(filename);const stored=raw.prepare('SELECT password_hash FROM users').get(),session=raw.prepare('SELECT token_hash FROM auth_sessions').get();
  assert.match(stored.password_hash,/^scrypt\$/);assert.ok(!stored.password_hash.includes(fixturePassword));assert.equal(session.token_hash.length,64);assert.notEqual(session.token_hash,login.token);raw.close();
  db=await createDatabase({filename,adminPassword:'different-not-applied'});
  assert.equal(db.authenticate(login.token).username,'Music');assert.equal(db.getPlaylist(login.user.id,p.id).tracks[0].rid,'42');
  await assert.rejects(db.login('Music','different-not-applied'),{status:401});
  db.logout(login.token);assert.equal(db.authenticate(login.token),null);db.close();
});

test('anonymous clients can load shell but catalog, provider accounts, media and cloud data require site login',async t=>{
  const {handler,login}=await fixture(t);
  assert.equal((await call(handler,'/',{method:'GET'})).status,200);
  assert.deepEqual((await call(handler,'/api/auth/status')).value,{enabled:true,user:null});
  for(const route of ['/api/catalog','/api/session','/api/account/status','/api/playlists/list','/api/admin/summary'])assert.equal((await call(handler,route)).status,401,route);
  assert.equal((await call(handler,'/api/media/unknown',{method:'GET'})).status,401);
  const cookie=login.cookies.find(x=>x.startsWith('__Host-bilimusic-auth='));
  assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);assert.match(cookie,/Secure/);assert.ok(!login.text.includes('scrypt'));
});

test('login rotates tokens and source-bound JSON requests cannot be forged cross-site',async t=>{
  const {db,handler,admin}=await fixture(t);
  assert.equal((await call(handler,'/api/auth/login',{body:{username:'Music',password:fixturePassword},headers:{origin:'https://evil.test'}})).status,403);
  assert.equal((await call(handler,'/api/auth/login',{body:{username:'Music',password:fixturePassword},headers:{'content-type':'text/plain'}})).status,415);
  const rotated=await call(handler,'/api/auth/login',{cookie:admin,body:{username:'Music',password:fixturePassword}}),next=jar(rotated,admin);
  assert.notEqual(next,admin);assert.equal((await call(handler,'/api/auth/status',{cookie:admin})).value.user,null);
  assert.equal((await call(handler,'/api/auth/status',{cookie:next})).value.user.username,'Music');assert.equal(db.summary().activeSessions,1);
  assert.equal((await call(handler,'/api/auth/login',{body:'x'.repeat(4097)})).status,413);
});

test('failed login is generic and the sixth attempt per IP and normalized name is throttled',async t=>{
  const db=await createDatabase({adminPassword:fixturePassword});t.after(()=>db.close());const handler=createHandler({publicOrigin:origin,database:db});
  const unknown=await call(handler,'/api/auth/login',{body:{username:'unknown',password:'wrong-pass'}});
  const bad=await call(handler,'/api/auth/login',{body:{username:'Music',password:'wrong-pass'}});
  assert.equal(unknown.value.error,bad.value.error);assert.equal(bad.status,401);
  for(let i=0;i<4;i++)assert.equal((await call(handler,'/api/auth/login',{body:{username:'music',password:'wrong-pass'}})).status,401);
  assert.equal((await call(handler,'/api/auth/login',{body:{username:'MUSIC',password:fixturePassword}})).status,429);
});

test('playlists support deduplicated add, order, edit, remove and delete with owner isolation',async t=>{
  const {handler,admin}=await fixture(t);
  assert.equal((await call(handler,'/api/admin/create-user',{cookie:admin,body:{username:'Listener',password:fixturePassword,role:'user'}})).status,200);
  const user=jar(await call(handler,'/api/auth/login',{body:{username:'Listener',password:fixturePassword}}));
  const created=await call(handler,'/api/playlists/create',{cookie:admin,body:{name:'我的歌单',description:'听音测试'}}),id=created.value.playlist.id;
  const added=await call(handler,'/api/playlists/add',{cookie:admin,body:{id,tracks:[song(42),song(43),song(42)]}});assert.equal(added.value.playlist.trackCount,2);
  const keys=added.value.playlist.tracks.map(x=>x.trackKey);assert.equal(keys[0],JSON.stringify(['kuwo','track','kuwo:42']));
  const reordered=await call(handler,'/api/playlists/reorder',{cookie:admin,body:{id,keys:keys.toReversed()}});assert.equal(reordered.value.playlist.tracks[0].rid,'43');
  assert.equal((await call(handler,'/api/playlists/reorder',{cookie:admin,body:{id,keys:[keys[0],keys[0]]}})).status,400);
  assert.equal((await call(handler,'/api/playlists/update',{cookie:admin,body:{id,name:'新名称'}})).value.playlist.name,'新名称');
  for(const [route,body] of [['get',{id}],['update',{id,name:'侵入'}],['delete',{id}],['add',{id,tracks:[song(44)]}],['remove',{id,trackKey:keys[0]}],['reorder',{id,keys}]])assert.equal((await call(handler,'/api/playlists/'+route,{cookie:user,body})).status,404,route);
  assert.deepEqual((await call(handler,'/api/playlists/list',{cookie:user})).value.playlists,[]);
  assert.equal((await call(handler,'/api/playlists/remove',{cookie:admin,body:{id,trackKey:keys[0]}})).value.playlist.trackCount,1);
  assert.equal((await call(handler,'/api/playlists/delete',{cookie:admin,body:{id}})).status,200);
  assert.equal((await call(handler,'/api/playlists/get',{cookie:admin,body:{id}})).status,404);
});

test('track persistence rejects credentials and forged identities; limits fail atomically',async t=>{
  const {db,handler,admin}=await fixture(t),owner=(await call(handler,'/api/auth/status',{cookie:admin})).value.user.id;
  const p=db.createPlaylist(owner,{name:'Boundaries'});
  for(const bad of [{...song(42),url:'https://private.test/stream'},{...song(42),headers:{Cookie:'secret'}},{...song(42),rid:'43'},{...song(42),source:'foreign'},{...song(42),cover:'http://127.0.0.1/file'}])assert.throws(()=>db.addTracks(owner,p.id,[song(43),bad]),{status:400});
  assert.equal(db.getPlaylist(owner,p.id).trackCount,0);
  assert.equal(db.addTracks(owner,p.id,Array.from({length:500},(_,i)=>song(i+1))).trackCount,500);
  assert.throws(()=>db.addTracks(owner,p.id,[song(501)]),{status:409});assert.equal(db.getPlaylist(owner,p.id).trackCount,500);
  for(let i=1;i<100;i++)db.createPlaylist(owner,{name:'歌单'+i});
  assert.throws(()=>db.createPlaylist(owner,{name:'Overflow'}),{status:409});
  assert.throws(()=>db.createPlaylist(owner,{name:'x'.repeat(81)}),{status:400});
});

test('admin APIs are role-gated and never expose password hashes or session tokens',async t=>{
  const {handler,admin}=await fixture(t);
  const made=await call(handler,'/api/admin/create-user',{cookie:admin,body:{username:'normal',password:fixturePassword,role:'user'}});assert.equal(made.value.user.role,'user');
  const user=jar(await call(handler,'/api/auth/login',{body:{username:'normal',password:fixturePassword}}));
  for(const route of ['/api/admin/summary','/api/admin/users','/api/admin/create-user'])assert.equal((await call(handler,route,{cookie:user})).status,403);
  const summary=await call(handler,'/api/admin/summary',{cookie:admin});assert.equal(summary.value.users,2);assert.equal(summary.value.activeSessions,2);
  const users=await call(handler,'/api/admin/users',{cookie:admin});assert.equal(users.value.users.length,2);assert.ok(!/scrypt|password|token_hash/.test(users.text));
  assert.equal((await call(handler,'/api/admin/create-user',{cookie:admin,body:{username:'NORMAL',password:fixturePassword}})).status,409);
});

test('provider and media sessions cannot cross site users and logout revokes old media immediately',async t=>{
  const flac='https://audio.kuwo.cn/song.flac';
  const {handler,admin}=await fixture(t,async url=>url.startsWith('https://mobi.kuwo.cn/mobi.s')?new Response(JSON.stringify({code:200,data:{rid:42,type:0,format:'flac',bitrate:2000,url:flac}})):new Response('fLaC'));
  await call(handler,'/api/admin/create-user',{cookie:admin,body:{username:'other',password:fixturePassword}});
  const other=jar(await call(handler,'/api/auth/login',{body:{username:'other',password:fixturePassword}}));
  const source=await call(handler,'/api/catalog',{cookie:admin,body:{op:'resolve',args:[{source:'kuwo',rid:'42'}]}}),withProvider=jar(source,admin),url=source.value.result[0].url;
  const providerCookie=source.cookies[0].split(';')[0];
  assert.equal((await call(handler,url,{method:'GET',cookie:withProvider})).status,200);
  assert.equal((await call(handler,url,{method:'GET',cookie:other+'; '+providerCookie})).status,404);
  assert.equal((await call(handler,url,{method:'GET',cookie:withProvider})).status,200);
  const logout=await call(handler,'/api/auth/logout',{cookie:withProvider});assert.equal(logout.status,200);assert.ok(logout.cookies.every(c=>c.includes('Max-Age=0')));
  assert.equal((await call(handler,url,{method:'GET',cookie:withProvider})).status,401);
  const fresh=jar(await call(handler,'/api/auth/login',{body:{username:'Music',password:fixturePassword}}));
  assert.equal((await call(handler,url,{method:'GET',cookie:fresh+'; '+providerCookie})).status,404);
});

test('logging out while a provider resolve is pending prevents a late authenticated response',async t=>{
  let release,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const reply=()=>new Response(JSON.stringify({code:200,data:{rid:42,type:0,format:'flac',bitrate:2000,url:'https://audio.kuwo.cn/song.flac'}}));
  const {handler,admin}=await fixture(t,async()=>{if(release)return reply();entered();return new Promise(resolve=>{release=()=>resolve(reply());});});
  const initial=await call(handler,'/api/session',{cookie:admin}),cookie=jar(initial,admin);
  const pending=call(handler,'/api/catalog',{cookie,body:{op:'resolve',args:[{source:'kuwo',rid:'42'}]}});
  await waiting;assert.equal((await call(handler,'/api/auth/logout',{cookie})).status,200);release();
  const late=await pending;assert.equal(late.status,401);assert.ok(!late.text.includes('/api/media/'));
});

test('session expiry and database errors do not disclose internal paths or SQL',async t=>{
  let now=1000;
  const db=await createDatabase({now:()=>now,adminPassword:fixturePassword});
  const login=await db.login('Music',fixturePassword);assert.ok(db.authenticate(login.token));now+=7*86400000;assert.equal(db.authenticate(login.token),null);db.close();
  const database={authenticate(){return {id:'fixture',username:'Music',role:'admin'};},listPlaylists(){throw Error('SQL failure in C:/private/state.sqlite SELECT secret');}};
  const handler=createHandler({publicOrigin:origin,database});const result=await call(handler,'/api/playlists/list');
  assert.equal(result.status,502);assert.ok(!/private|sqlite|SELECT|SQL/.test(result.text));
});

test('hash-only bootstrap validates scrypt format and never overwrites an existing account',async()=>{
  for(const bad of ['', 'scrypt$abc$def', 'plaintext-password', 'scrypt$'+'z'.repeat(32)+'$'+'0'.repeat(128)])await assert.rejects(createDatabase({adminPasswordHash:bad}),{status:503});
  const salt=randomBytes(16),hash='scrypt$'+salt.toString('hex')+'$'+scryptSync(fixturePassword,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
  const db=await createDatabase({adminUsername:'Music',adminPasswordHash:hash});
  assert.equal((await db.login('Music',fixturePassword)).user.role,'admin');
  assert.equal(await db.bootstrapAdmin('Unexpected','different-password','invalid-hash'),false);
  assert.equal(db.listUsers().length,1);assert.equal(db.listUsers()[0].username,'Music');
  await assert.rejects(db.login('Music','different-password'),{status:401});db.close();
});

test('concurrent first-run initialization creates only one administrator',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bilimusic-db-test-')),filename=path.join(directory,'state.sqlite');
  const first=new MusicDatabase({filename}),second=new MusicDatabase({filename});
  t.after(()=>{first.close();second.close();for(const suffix of ['', '-wal','-shm'])if(existsSync(filename+suffix))unlinkSync(filename+suffix);rmdirSync(directory);});
  const results=await Promise.all([first.bootstrapAdmin('first',fixturePassword),second.bootstrapAdmin('second',fixturePassword)]);
  assert.deepEqual(results.toSorted(),[false,true]);assert.equal(first.listUsers().length,1);
});

test('logout during a slow JSON upload prevents the formerly authorized database mutation',async t=>{
  const {db,handler,admin}=await fixture(t);let release,started;
  const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const pending=call(handler,'/api/playlists/create',{cookie:admin,body:{name:'must not be saved'},bodyGate:()=>{started();return gate;}});
  await ready;assert.equal((await call(handler,'/api/auth/logout',{cookie:admin})).status,200);release();
  assert.equal((await pending).status,401);assert.equal(db.summary().playlists,0);
});

test('logout wins over a previously started login rotation that finishes hashing later',async t=>{
  const {db,handler,admin}=await fixture(t);let release,entered;
  const oldLogin=db.login.bind(db),ready=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  db.login=async(...args)=>{entered();await gate;return oldLogin(...args);};
  const pending=call(handler,'/api/auth/login',{cookie:admin,body:{username:'Music',password:fixturePassword}});
  await ready;assert.equal((await call(handler,'/api/auth/logout',{cookie:admin})).status,200);release();
  const result=await pending;assert.equal(result.status,401);assert.equal(result.cookies.length,0);assert.equal(db.summary().activeSessions,0);
});

test('production environment options use the persistent state directory and support hash-only first start',async t=>{
  const directory=mkdtempSync(path.join(tmpdir(),'bilimusic-db-test-')),filename=path.join(directory,'bilimusic.sqlite');
  t.after(()=>{for(const suffix of ['', '-wal','-shm'])if(existsSync(filename+suffix))unlinkSync(filename+suffix);rmdirSync(directory);});
  const salt=randomBytes(16),hash='scrypt$'+salt.toString('hex')+'$'+scryptSync(fixturePassword,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024}).toString('hex');
  const opts=databaseOptionsFromEnv({BILIMUSIC_STATE_DIR:directory,STATE_DIR:'ignored-state',BILIMUSIC_ADMIN_PASSWORD_HASH:hash});
  assert.equal(opts.filename,filename);assert.equal(opts.adminUsername,'Music');assert.equal(opts.adminPassword,undefined);
  assert.equal(databaseOptionsFromEnv({BILIMUSIC_DB_PATH:'explicit.sqlite',BILIMUSIC_STATE_DIR:directory}).filename,'explicit.sqlite');
  assert.equal(databaseOptionsFromEnv({STATE_DIR:directory}).filename,filename);
  const db=await createDatabase(opts);assert.equal((await db.login('Music',fixturePassword)).user.role,'admin');db.close();
});

test('one add request accepts 500 maximum Chinese metadata tracks while other routes retain their smaller limit',async t=>{
  const {handler,admin}=await fixture(t),created=await call(handler,'/api/playlists/create',{cookie:admin,body:{name:'完整批次'}}),id=created.value.playlist.id;
  const prefix='https://i0.hdslb.com/',cover=prefix+'a'.repeat(2048-prefix.length);
  const tracks=Array.from({length:500},(_,i)=>({source:'kuwo',type:'track',id:'kuwo:'+String(100000000000000000n+BigInt(i)),rid:String(100000000000000000n+BigInt(i)),title:'界'.repeat(300),artist:'界'.repeat(200),album:'界'.repeat(200),cover,duration:86400}));
  const body={id,tracks},bytes=Buffer.byteLength(JSON.stringify(body));assert.ok(bytes>512*1024&&bytes<4*1024*1024);
  const added=await call(handler,'/api/playlists/add',{cookie:admin,body});
  assert.equal(added.status,200);assert.equal(added.value.playlist.trackCount,500);assert.equal(added.value.playlist.tracks[499].cover,cover);
  assert.equal((await call(handler,'/api/playlists/get',{cookie:admin,body:{id}})).value.playlist.trackCount,500);
  assert.equal((await call(handler,'/api/playlists/update',{cookie:admin,body})).status,413);
  assert.equal((await call(handler,'/api/playlists/add',{cookie:admin,body:{...body,padding:'x'.repeat(4*1024*1024)}})).status,413);
});
