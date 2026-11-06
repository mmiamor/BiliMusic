import { renderSiteLogin } from './site-auth-view.mjs';
import { icon } from './icons.mjs';

const esc = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function siteRequest(path, input={}) {
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),20000);
  try {
    const response=await fetch('/api/'+path,{method:'POST',credentials:'same-origin',cache:'no-store',signal:controller.signal,
      headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});
    const data=await response.json();
    if(!response.ok) {
      if(response.status===401&&!path.startsWith('auth/'))window.dispatchEvent(new Event('bilimusic:auth-required'));
      const error=Error(data.error||'请求未完成，请重试。');error.status=response.status;throw error;
    }
    return data;
  }catch(error){
    if(controller.signal.aborted)throw Error('连接超时，请稍后重试。');
    if(error instanceof TypeError||error instanceof SyntaxError)throw Error('无法连接音乐服务，请检查网络后重试。');
    throw error;
  }finally{clearTimeout(timer);}
}

export class SiteSession {
  user=null; enabled=false; pending=null; resolve=null; root=null; busy=false; username='Music';
  async initialize(platform) {
    if(platform!=='pwa')return;
    this.enabled=true;
    window.addEventListener('bilimusic:auth-required',()=>{void this.lock().then(()=>location.reload());});
    try {
      const result=await siteRequest('auth/status');this.user=result.user;
      if(this.user)return;
      await this.lock();
    }catch(error){await this.lock(error.message);}
  }
  render(error='',checking=false) {
    if(!this.root) {
      this.root=document.createElement('div');this.root.id='site-auth';document.body.append(this.root);
      this.root.addEventListener('submit',event=>{if(!event.target.matches('[data-site-login]'))return;event.preventDefault();void this.login(event.target);});
      this.root.addEventListener('click',event=>{
        const action=event.target.closest('[data-auth-action]')?.dataset.authAction;
        if(action==='retry')void this.retry();
        if(action==='toggle-password') {
          const field=this.root.querySelector('[name="password"]'),button=event.target.closest('button');
          field.type=field.type==='password'?'text':'password';
          button.setAttribute('aria-pressed',String(field.type==='text'));
          button.setAttribute('aria-label',field.type==='text'?'隐藏密码':'显示密码');
          button.textContent=field.type==='text'?'隐藏':'显示';
        }
      });
    }
    document.body.classList.add('site-locked');
    for(const dialog of document.querySelectorAll('dialog[open]')) dialog.close();
    this.root.innerHTML=renderSiteLogin({busy:this.busy,error,username:this.username,checking},{esc,icon});
    if(!this.busy&&!checking)this.root.querySelector('[name="password"]')?.focus();
  }
  lock(error='') {
    if(this.pending)return this.pending;
    this.user=null;
    this.pending=new Promise(resolve=>{this.resolve=resolve;});
    this.render(error);return this.pending;
  }
  unlock(user) {
    this.user=user;this.busy=false;
    this.root?.remove();this.root=null;document.body.classList.remove('site-locked');
    const resolve=this.resolve;this.resolve=null;this.pending=null;resolve?.(user);
  }
  async retry() {
    if(this.busy)return;this.busy=true;this.render('',true);
    try{const data=await siteRequest('auth/status');if(data.user)this.unlock(data.user);else{this.busy=false;this.render();}}
    catch(error){this.busy=false;this.render(error.message);}
  }
  async login(form) {
    if(this.busy)return;
    this.username=form.elements.username.value.trim();const password=form.elements.password.value;
    if(!this.username||!password){this.render('请输入账号和密码。');return;}
    this.busy=true;this.render();
    try{const data=await siteRequest('auth/login',{username:this.username,password});if(!data.user)throw Error('未取得有效账号状态。');this.unlock(data.user);}
    catch(error){this.busy=false;this.render(error.message);}
  }
  async logout() {
    try { await siteRequest('auth/logout'); }
    catch(error) { if(error.status!==401)throw error; }
    location.reload();
  }
}
export const siteSession=new SiteSession();
