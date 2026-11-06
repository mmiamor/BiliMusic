import { DISCOVERY_CATEGORIES } from './discovery-categories.mjs';

const preferenceKey = 'bilimusic.preferences.v1';
export const validStartCategory = value => DISCOVERY_CATEGORIES.some(item => item.id === value);
export function readPreferences(storage) {
  try {
    const saved = JSON.parse(storage.getItem(preferenceKey));
    if (validStartCategory(saved?.startCategory)) return { startCategory: saved.startCategory };
  } catch { /* A restricted or old storage entry must not prevent startup. */ }
  return { startCategory: 'hires' };
}
export function savePreferences(storage, value) {
  if (!validStartCategory(value?.startCategory)) return false;
  try { storage.setItem(preferenceKey, JSON.stringify({ startCategory: value.startCategory })); return true; }
  catch { return false; }
}

export function parseAccountResponse(response) {
  if (!response || response.status < 200 || response.status >= 300 || !Number.isInteger(response.status)) {
    throw new Error('暂时无法连接哔哩哔哩，请稍后重新检查。');
  }
  let value;
  try { value = JSON.parse(response.body); } catch { throw new Error('账号服务返回的内容无效，请重新检查。'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('账号服务返回的内容无效，请重新检查。');
  }
  if (value.code === -101) return { loggedIn: false, name: '' };
  if (value.code !== 0 || typeof value.data?.isLogin !== 'boolean') {
    throw new Error('暂时无法确认哔哩哔哩登录状态，请重新检查。');
  }
  return { loggedIn: value.data.isLogin, name: value.data.isLogin ? String(value.data.uname || '已登录') : '' };
}

// Account checks never interpret an unavailable service or a closed login
// window as an authenticated session. Older reads cannot undo a newer action.
export class AccountController {
  constructor({ read, login, logout, onChange = () => {}, onSessionChanged = () => {} }) {
    this.read = read;
    this.loginAction = login;
    this.logoutAction = logout;
    this.onChange = onChange;
    this.onSessionChanged = onSessionChanged;
    this.state = { status: 'unknown', name: '', error: '', busy: false };
    this.generation = 0;
    this.pending = null;
    this.operation = null;
    this.confirmed = null;
  }

  async readCurrent(generation) {
    try {
      const data = await this.read();
      if (generation !== this.generation) return this.state;
      if (typeof data?.loggedIn !== 'boolean') throw new Error('账号服务未返回有效的登录状态。');
      const next = { loggedIn: data.loggedIn, name: data.loggedIn ? String(data.name || '已登录') : '' };
      const previous = this.confirmed;
      this.confirmed = next;
      Object.assign(this.state, { status: next.loggedIn ? 'signed-in' : 'signed-out', name: next.name, error: '' });
      if (previous && (previous.loggedIn !== next.loggedIn || previous.name !== next.name)) {
        await this.onSessionChanged({ previous, current: next });
      }
    } catch (error) {
      if (generation === this.generation) Object.assign(this.state, { status: 'error', error: error?.message || '暂时无法读取账号状态。' });
    }
    if (generation === this.generation) this.onChange(this.state);
    return this.state;
  }

  refresh() {
    if (this.operation) return this.operation;
    if (this.pending) return this.pending;
    const generation = ++this.generation;
    Object.assign(this.state, { status: 'loading', error: '' });
    this.onChange(this.state);
    const pending = Promise.resolve().then(() => this.readCurrent(generation)).finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  change(kind) {
    if (this.operation) return this.operation;
    if (!['login', 'logout'].includes(kind)) return Promise.resolve(this.state);
    const hook = kind === 'login' ? this.loginAction : this.logoutAction;
    if (typeof hook !== 'function') return Promise.resolve(this.state);
    // A stale name is not authorization to log out. Recover a confirmed state
    // first; the next explicit click chooses the intended operation.
    if ((kind === 'login' && this.state.status !== 'signed-out') ||
        (kind === 'logout' && this.state.status !== 'signed-in')) return this.refresh();
    const generation = ++this.generation;
    this.pending = null;
    Object.assign(this.state, { busy: kind, error: '' });
    this.onChange(this.state);
    const operation = Promise.resolve().then(hook).then(() => this.readCurrent(generation)).catch(error => {
      if (generation === this.generation) Object.assign(this.state, { status: 'error', error: error?.message || '账号操作未完成，请重试。' });
    }).finally(() => {
      if (generation === this.generation) {
        this.state.busy = false;
        this.onChange(this.state);
      }
      if (this.operation === operation) this.operation = null;
    }).then(() => this.state);
    this.operation = operation;
    return operation;
  }
}
