import { createHash } from 'node:crypto';
import { HttpError } from './provider-network.mjs';

const requireValue=(ok,status,message)=>{if(!ok)throw new HttpError(status,message);};
export function createAuthRoutes({database,secure,rate,onSessionEnd=()=>{}}) {
  const cookieName=secure?'__Host-bilimusic-auth':'bilimusic_auth_dev';
  const flags='; Path=/; HttpOnly; SameSite=Lax'+(secure?'; Secure':'');
  let pendingLogins=0;
  const tokenFor=req=>(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1)||'';
  const keyFor=token=>token?createHash('sha256').update(token).digest('hex'):'';
  return {
    read(req) {const token=tokenFor(req),user=database?.authenticate(token)||null;return {token,key:keyFor(token),user,hadUser:Boolean(user)};},
    async handle(pathname,input,{auth,clientIP,now}) {
      if(pathname==='/api/auth/status')return {value:{enabled:Boolean(database),user:auth.user}};
      if(!database)return null;
      if(pathname==='/api/auth/login') {
        requireValue(!auth.hadUser||auth.user,401,'登录状态已变更，请重新登录。');
        requireValue(typeof input.username==='string'&&input.username.length<=80&&typeof input.password==='string'&&input.password.length<=128,400,'登录参数无效。');
        rate('login:'+clientIP+':'+input.username.normalize('NFKC').trim().toLowerCase(),5,now);
        rate('login-ip:'+clientIP,20,now);
        requireValue(pendingLogins<4,429,'登录请求较多，请稍后重试。');
        pendingLogins++;
        try {
          const result=await database.login(input.username,input.password);
          if(auth.hadUser&&!database.authenticate(auth.token)) {
            database.logout(result.token);
            throw new HttpError(401,'登录状态已变更，请重新登录。');
          }
          database.logout(auth.token); onSessionEnd(auth.key);
          return {value:{user:result.user},clearProvider:true,cookies:[cookieName+'='+result.token+flags+'; Max-Age=604800']};
        } finally {pendingLogins--;}
      }
      requireValue(auth.user,401,'请先登录 BiliMusic。');
      if(pathname==='/api/auth/logout') {
        database.logout(auth.token);onSessionEnd(auth.key);
        return {value:{},clearProvider:true,cookies:[cookieName+'='+flags+'; Max-Age=0']};
      }
      const id=auth.user.id;
      switch(pathname) {
        case '/api/playlists/list':return {value:{playlists:database.listPlaylists(id)}};
        case '/api/playlists/get':return {value:{playlist:database.getPlaylist(id,input.id)}};
        case '/api/playlists/create':return {value:{playlist:database.createPlaylist(id,input)}};
        case '/api/playlists/update':return {value:{playlist:database.updatePlaylist(id,input)}};
        case '/api/playlists/delete':database.deletePlaylist(id,input.id);return {value:{}};
        case '/api/playlists/add':return {value:{playlist:database.addTracks(id,input.id,input.tracks)}};
        case '/api/playlists/remove':return {value:{playlist:database.removeTrack(id,input.id,input.trackKey)}};
        case '/api/playlists/reorder':return {value:{playlist:database.reorderTracks(id,input.id,input.keys)}};
      }
      if(pathname.startsWith('/api/admin/')) {
        requireValue(auth.user.role==='admin',403,'此操作需要管理员权限。');
        if(pathname==='/api/admin/summary')return {value:database.summary()};
        if(pathname==='/api/admin/users')return {value:{users:database.listUsers()}};
        if(pathname==='/api/admin/create-user') {
          rate('create-user:'+id,10,now);
          return {value:{user:await database.createUser(input,()=>database.authenticate(auth.token)?.role==='admin')}};
        }
      }
      return null;
    },
  };
}
