import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdirSync, chmodSync, statSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './provider-network.mjs';
import { cleanPlaylistTrack as cleanPublicTrack } from '../src/playlist-track.mjs';

const scrypt = promisify(scryptCallback), sessionTTL = 7 * 86400000;
const requireValue = (ok, status, message) => { if (!ok) throw new HttpError(status, message); };
const publicUser = row => row ? { id: row.id, username: row.username, role: row.role } : null;
const digest = token => createHash('sha256').update(token).digest('hex');
const validToken = token => typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token);
const text = (value, max, required = false) => {
  requireValue(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value),400,'文字参数无效或过长。');
  const out=value.trim(); requireValue(!required||out.length>0,400,'名称不能为空。'); return out;
};
function username(value) {
  requireValue(typeof value==='string',400,'账号名称无效。');
  const name=value.normalize('NFKC').trim();
  requireValue(/^[\p{L}\p{N}_.-]{1,40}$/u.test(name),400,'账号名称应为 1–40 个文字、数字、点、下划线或连字符。');
  return {display:name,key:name.toLowerCase()};
}
function password(value) { requireValue(typeof value==='string'&&value.length>=8&&value.length<=128,400,'密码长度应为 8–128 个字符。'); return value; }
async function passwordHash(value) {
  const salt=randomBytes(16), hash=await scrypt(password(value),salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return 'scrypt$'+salt.toString('hex')+'$'+hash.toString('hex');
}
async function passwordMatches(value, encoded) {
  const parts=encoded?.split('$')||[];
  const salt=parts.length===3?Buffer.from(parts[1],'hex'):Buffer.alloc(16,9);
  const expected=parts.length===3?Buffer.from(parts[2],'hex'):Buffer.alloc(64);
  const actual=await scrypt(value,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return expected.length===actual.length&&timingSafeEqual(expected,actual);
}
export function cleanPlaylistTrack(input) {
  try { const track=cleanPublicTrack(input); if(track.source==='local')delete track.file; return track; }
  catch(error) { throw new HttpError(400,error.message||'曲目参数无效。'); }
}
const trackKey = track => JSON.stringify([track.source,'track',track.id]);
function trackResult(row) {
  return {...cleanPublicTrack(JSON.parse(row.metadata)),trackKey:row.track_key};
}

export class MusicDatabase {
  #db; #filename; #now;
  constructor({filename=':memory:',now=Date.now}={}) {
    this.#filename=filename;this.#now=now;
    if(filename!==':memory:') mkdirSync(path.dirname(path.resolve(filename)),{recursive:true,mode:0o700});
    this.#db=new DatabaseSync(filename);
    if(filename!==':memory:') { try {chmodSync(filename,0o600);}catch{} }
    this.#db.exec(`PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,password_hash TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','user')),created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
      CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,description TEXT NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS playlists_owner ON playlists(user_id,updated_at);
      CREATE TABLE IF NOT EXISTS playlist_tracks(playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,track_key TEXT NOT NULL,position INTEGER NOT NULL,metadata TEXT NOT NULL,PRIMARY KEY(playlist_id,track_key));
      CREATE INDEX IF NOT EXISTS playlist_tracks_order ON playlist_tracks(playlist_id,position);
      PRAGMA user_version=1;`);
  }
  close() {this.#db.close();}
  async bootstrapAdmin(name, secret, encodedHash) {
    if(this.#db.prepare('SELECT COUNT(*) AS n FROM users').get().n) return false;
    let encoded;
    if(encodedHash!==undefined) {
      requireValue(typeof encodedHash==='string'&&/^scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}$/.test(encodedHash),503,'初始化密码哈希格式无效。');
      encoded=encodedHash;
    } else {
      requireValue(typeof secret==='string'&&secret.length>0,503,'首次启动必须设置管理员密码或密码哈希。');
      encoded=await passwordHash(secret);
    }
    const account=username(name||'Music');
    return this.#transaction(()=>{
      if(this.#db.prepare('SELECT COUNT(*) AS n FROM users').get().n)return false;
      this.#db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(randomUUID(),account.display,account.key,encoded,'admin',this.#now());
      return true;
    });
  }
  async createUser(input, authorize = () => true) {
    const name=username(input.username), role=input.role??'user';
    requireValue(role==='user'||role==='admin',400,'账号角色无效。');
    const encoded=await passwordHash(input.password), id=randomUUID(), createdAt=this.#now();
    requireValue(authorize(),401,'登录状态已失效，请重新登录。');
    try {this.#db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,name.display,name.key,encoded,role,createdAt);}
    catch(error) {if(error.code==='ERR_SQLITE_ERROR'&&/UNIQUE constraint failed: users.username_key/.test(error.message))throw new HttpError(409,'账号名称已存在。');throw error;}
    return {id,username:name.display,role,createdAt};
  }
  async login(name, secret) {
    let key;try {key=username(name).key;}catch{key='';}
    requireValue(typeof secret==='string'&&secret.length<=128,400,'登录参数无效。');
    const row=this.#db.prepare('SELECT * FROM users WHERE username_key=?').get(key);
    const match=await passwordMatches(secret,row?.password_hash);
    requireValue(row&&match,401,'账号或密码错误。');
    const token=randomBytes(32).toString('base64url'), now=this.#now(), expiresAt=now+sessionTTL;
    this.#db.exec('BEGIN IMMEDIATE');
    try {
      this.#db.prepare('DELETE FROM auth_sessions WHERE expires_at<=?').run(now);
      this.#db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(digest(token),row.id,now,expiresAt);
      this.#db.prepare('DELETE FROM auth_sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM auth_sessions WHERE user_id=? ORDER BY created_at DESC,rowid DESC LIMIT 10)').run(row.id,row.id);
      this.#db.exec('COMMIT');
    }catch(error){this.#db.exec('ROLLBACK');throw error;}
    return {token,expiresAt,user:publicUser(row)};
  }
  authenticate(token) {
    if(!validToken(token))return null;
    const row=this.#db.prepare('SELECT users.id,users.username,users.role FROM auth_sessions JOIN users ON users.id=auth_sessions.user_id WHERE token_hash=? AND expires_at>?').get(digest(token),this.#now());
    return publicUser(row);
  }
  logout(token) {if(validToken(token))this.#db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(digest(token));}
  listUsers() {return this.#db.prepare('SELECT id,username,role,created_at AS createdAt FROM users ORDER BY created_at,id').all();}
  summary() {
    const count=table=>this.#db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n;
    let databaseBytes=0;if(this.#filename!==':memory:')for(const suffix of ['', '-wal','-shm'])try{databaseBytes+=statSync(this.#filename+suffix).size;}catch{}
    return {users:count('users'),playlists:count('playlists'),tracks:count('playlist_tracks'),activeSessions:this.#db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE expires_at>?').get(this.#now()).n,databaseBytes};
  }
  #meta(user,id) {
    requireValue(typeof id==='string'&&id.length<=64,400,'歌单标识无效。');
    const row=this.#db.prepare('SELECT id,name,description,created_at AS createdAt,updated_at AS updatedAt,(SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id=playlists.id) AS trackCount FROM playlists WHERE id=? AND user_id=?').get(id,user);
    requireValue(row,404,'歌单不存在。');return row;
  }
  listPlaylists(user) {return this.#db.prepare('SELECT id,name,description,created_at AS createdAt,updated_at AS updatedAt,(SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id=playlists.id) AS trackCount FROM playlists WHERE user_id=? ORDER BY updated_at DESC,id').all(user);}
  getPlaylist(user,id) {return {...this.#meta(user,id),tracks:this.#db.prepare('SELECT track_key,metadata FROM playlist_tracks WHERE playlist_id=? ORDER BY position,track_key').all(id).map(trackResult)};}
  createPlaylist(user,input) {
    const name=text(input.name,80,true),description=text(input.description??'',500),now=this.#now(),id=randomUUID();
    requireValue(this.#db.prepare('SELECT COUNT(*) AS n FROM playlists WHERE user_id=?').get(user).n<100,409,'每个账号最多创建 100 个歌单。');
    this.#db.prepare('INSERT INTO playlists VALUES(?,?,?,?,?,?)').run(id,user,name,description,now,now);return this.getPlaylist(user,id);
  }
  updatePlaylist(user,input) {
    const old=this.#meta(user,input.id),name=input.name===undefined?old.name:text(input.name,80,true),description=input.description===undefined?old.description:text(input.description,500);
    this.#db.prepare('UPDATE playlists SET name=?,description=?,updated_at=? WHERE id=? AND user_id=?').run(name,description,this.#now(),input.id,user);return this.getPlaylist(user,input.id);
  }
  deletePlaylist(user,id) {this.#meta(user,id);this.#db.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').run(id,user);}
  #transaction(fn) {this.#db.exec('BEGIN IMMEDIATE');try{const result=fn();this.#db.exec('COMMIT');return result;}catch(error){this.#db.exec('ROLLBACK');throw error;}}
  addTracks(user,id,tracks) {
    this.#meta(user,id);requireValue(Array.isArray(tracks)&&tracks.length>0&&tracks.length<=500,400,'每次请添加 1–500 首曲目。');
    const cleaned=[...new Map(tracks.map(item=>{const t=cleanPlaylistTrack(item);return [trackKey(t),t];})).values()];
    return this.#transaction(()=>{
      const current=this.#db.prepare('SELECT track_key FROM playlist_tracks WHERE playlist_id=?').all(id),keys=new Set(current.map(x=>x.track_key));
      const added=cleaned.filter(t=>!keys.has(trackKey(t)));requireValue(current.length+added.length<=500,409,'每个歌单最多保存 500 首曲目。');
      let position=this.#db.prepare('SELECT COALESCE(MAX(position),-1) AS p FROM playlist_tracks WHERE playlist_id=?').get(id).p+1;
      const insert=this.#db.prepare('INSERT INTO playlist_tracks VALUES(?,?,?,?)');
      for(const track of added)insert.run(id,trackKey(track),position++,JSON.stringify(track));
      this.#db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(this.#now(),id);
      return this.getPlaylist(user,id);
    });
  }
  removeTrack(user,id,key) {
    this.#meta(user,id);requireValue(typeof key==='string'&&key.length<=256,400,'曲目标识无效。');
    return this.#transaction(()=>{this.#db.prepare('DELETE FROM playlist_tracks WHERE playlist_id=? AND track_key=?').run(id,key);this.#db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(this.#now(),id);return this.getPlaylist(user,id);});
  }
  reorderTracks(user,id,keys) {
    const p=this.getPlaylist(user,id);requireValue(Array.isArray(keys)&&keys.length===p.tracks.length&&keys.every(k=>typeof k==='string'&&k.length<=256)&&new Set(keys).size===keys.length,400,'曲目排序无效。');
    const actual=new Set(p.tracks.map(t=>t.trackKey));requireValue(keys.every(k=>actual.has(k)),400,'排序必须包含歌单全部曲目。');
    return this.#transaction(()=>{const update=this.#db.prepare('UPDATE playlist_tracks SET position=? WHERE playlist_id=? AND track_key=?');keys.forEach((key,i)=>update.run(i,id,key));this.#db.prepare('UPDATE playlists SET updated_at=? WHERE id=?').run(this.#now(),id);return this.getPlaylist(user,id);});
  }
}

export async function createDatabase(options={}) {const db=new MusicDatabase(options);try{if(options.bootstrap!==false)await db.bootstrapAdmin(options.adminUsername||'Music',options.adminPassword,options.adminPasswordHash);return db;}catch(error){db.close();throw error;}}
