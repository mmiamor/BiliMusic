import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountController, parseAccountResponse, readPreferences, savePreferences } from '../src/settings-model.mjs';

const guest = { loggedIn: false, name: '' };
const signedIn = { loggedIn: true, name: '测试账号' };
const drain = () => new Promise(setImmediate);
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(onSessionChanged) {
  const reads = [], logins = [], logouts = [], changes = [], sessions = [];
  const enqueue = list => { const request = deferred(); list.push(request); return request.promise; };
  const account = new AccountController({
    read: () => enqueue(reads), login: () => enqueue(logins), logout: () => enqueue(logouts),
    onChange: state => changes.push({ ...state }),
    onSessionChanged: event => {
      sessions.push(event);
      return onSessionChanged?.(event);
    },
  });
  async function confirm(value) {
    const pending = account.refresh();
    await drain();
    reads.at(-1).resolve(value);
    await pending;
  }
  return { account, reads, logins, logouts, changes, sessions, confirm };
}

test('account parser distinguishes confirmed guests from authenticated responses', () => {
  const parse = value => parseAccountResponse({ status: 200, body: JSON.stringify(value) });
  assert.deepEqual(parse({ code: 0, data: { isLogin: true, uname: '测试账号' } }), signedIn);
  assert.deepEqual(parse({ code: 0, data: { isLogin: true } }), { loggedIn: true, name: '已登录' });
  assert.deepEqual(parse({ code: 0, data: { isLogin: false, uname: '过期名称' } }), guest);
  assert.deepEqual(parse({ code: -101, data: { wbi_img: {} } }), guest);
});

test('HTTP failures and invalid response statuses cannot become signed-out accounts', () => {
  for (const status of [undefined, null, 0, 199, 300, 403, 429, 500, '200', 200.5, NaN]) {
    assert.throws(() => parseAccountResponse({ status, body: '{"code":-101}' }), /连接/, String(status));
  }
  assert.throws(() => parseAccountResponse(null), /连接/);
});

test('business failures and malformed payloads return readable account errors, not guest state', () => {
  const bodies = ['not json', '', 'null', '[]', '{}', '"text"',
    '{"code":-352,"message":"request restricted"}', '{"code":"-101"}',
    '{"code":"0","data":{"isLogin":true}}', '{"code":0}',
    '{"code":0,"data":null}', '{"code":0,"data":{"isLogin":"false"}}'];
  for (const body of bodies) {
    assert.throws(() => parseAccountResponse({ status: 200, body }), error =>
      error instanceof Error && !(error instanceof TypeError) && /账号|登录/.test(error.message), body);
  }
});

test('initial checks are lazy and overlapping refreshes share one authoritative read', async () => {
  const f = fixture();
  assert.equal(f.account.state.status, 'unknown');
  assert.equal(f.reads.length, 0);
  const first = f.account.refresh();
  assert.equal(first, f.account.refresh());
  assert.equal(f.account.state.status, 'loading');
  await drain();
  assert.equal(f.reads.length, 1);
  f.reads[0].resolve(signedIn);
  await first;
  assert.equal(f.account.state.status, 'signed-in');
  assert.equal(f.account.state.name, signedIn.name);
  assert.equal(f.sessions.length, 0, 'first observation is not a proven session change');
});

test('closing a login without an account change neither clears caches nor reports a changed session', async () => {
  const f = fixture();
  await f.confirm(guest);
  const attempt = f.account.change('login');
  assert.equal(attempt, f.account.change('login'));
  assert.equal(attempt, f.account.change('logout'), 'opposite requests do not queue behind an active login');
  assert.equal(attempt, f.account.refresh());
  await drain();
  assert.equal(f.logins.length, 1);
  assert.equal(f.logouts.length, 0);
  f.logins[0].resolve(); // All native login windows can close without completing authentication.
  await drain();
  assert.equal(f.reads.length, 2);
  f.reads[1].resolve(guest);
  await attempt;
  assert.equal(f.account.state.status, 'signed-out');
  assert.equal(f.account.state.busy, false);
  assert.equal(f.account.state.error, '');
  assert.equal(f.sessions.length, 0);
});

test('confirmed login and logout each notify once, while a same-account refresh does not', async () => {
  const f = fixture();
  await f.confirm(guest);
  const login = f.account.change('login');
  await drain();
  f.logins[0].resolve();
  await drain();
  f.reads.at(-1).resolve(signedIn);
  await login;
  assert.deepEqual(f.sessions, [{ previous: guest, current: signedIn }]);
  await f.confirm(signedIn);
  assert.equal(f.sessions.length, 1);
  const logout = f.account.change('logout');
  await drain();
  f.logouts[0].resolve();
  await drain();
  f.reads.at(-1).resolve(guest);
  await logout;
  assert.deepEqual(f.sessions[1], { previous: signedIn, current: guest });
  assert.equal(f.account.state.busy, false);
  assert.equal(f.account.state.name, '');
});

test('failed account actions retain the confirmed name and always release their busy state', async () => {
  const f = fixture();
  await f.confirm(signedIn);
  const operation = f.account.change('logout');
  await drain();
  f.logouts[0].reject(new Error('退出请求失败'));
  await operation;
  assert.equal(f.account.state.status, 'error');
  assert.equal(f.account.state.error, '退出请求失败');
  assert.equal(f.account.state.name, signedIn.name);
  assert.equal(f.account.state.busy, false);
  assert.equal(f.reads.length, 1, 'a rejected mutation does not pretend to have completed');
  assert.equal(f.sessions.length, 0);
  await f.confirm(signedIn);
  assert.equal(f.account.state.status, 'signed-in');
  assert.equal(f.account.state.error, '');
});

test('failed or malformed status reads preserve the last name until a later result confirms logout', async () => {
  const f = fixture();
  await f.confirm(signedIn);
  const operation = f.account.change('logout');
  await drain();
  f.logouts[0].resolve();
  await drain();
  f.reads.at(-1).reject(new Error('状态服务暂时不可用'));
  await operation;
  assert.equal(f.account.state.status, 'error');
  assert.equal(f.account.state.busy, false);
  assert.equal(f.account.state.name, signedIn.name);
  assert.equal(f.sessions.length, 0);
  await f.confirm({ name: '不可信名称' });
  assert.equal(f.account.state.status, 'error');
  assert.equal(f.account.state.name, signedIn.name);
  await f.confirm(guest);
  assert.deepEqual(f.sessions, [{ previous: signedIn, current: guest }]);
  assert.equal(f.account.state.status, 'signed-out');
});

test('unknown, loading or failed status cannot use a stale name to authorize logout', async () => {
  const f = fixture();
  const initial = f.account.change('logout');
  assert.equal(initial, f.account.change('logout'));
  await drain();
  assert.equal(f.logouts.length, 0);
  f.reads[0].resolve(signedIn);
  await initial;
  const failed = f.account.refresh();
  await drain();
  f.reads.at(-1).reject(new Error('offline'));
  await failed;
  const recovery = f.account.change('logout');
  await drain();
  assert.equal(f.logouts.length, 0, 'a recovery check must not become a delayed logout');
  f.reads.at(-1).resolve(signedIn);
  await recovery;
  assert.equal(f.logouts.length, 0);
  const explicit = f.account.change('logout');
  await drain();
  assert.equal(f.logouts.length, 1);
  f.logouts[0].resolve();
  await drain();
  f.reads.at(-1).resolve(guest);
  await explicit;
});

test('a late refresh callback failure cannot overwrite a newer completed account operation', async () => {
  const oldCallback = deferred();
  const f = fixture(event => event.current.loggedIn ? oldCallback.promise : undefined);
  await f.confirm(guest);
  const earlier = f.account.refresh();
  await drain();
  f.reads.at(-1).resolve(signedIn);
  await drain(); // The read is confirmed, but its async session-change work is unfinished.
  assert.equal(f.account.state.status, 'signed-in');
  const newer = f.account.change('logout');
  await drain();
  f.logouts[0].resolve();
  await drain();
  f.reads.at(-1).resolve(guest);
  await newer;
  const changeCount = f.changes.length;
  oldCallback.reject(new Error('old session cleanup failed'));
  await earlier;
  assert.equal(f.account.state.status, 'signed-out');
  assert.equal(f.account.state.name, '');
  assert.equal(f.account.state.error, '');
  assert.equal(f.account.state.busy, false);
  assert.equal(f.changes.length, changeCount, 'stale completion must not repaint the account');
});

test('preferences persist only the selected approved default category', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  assert.deepEqual(readPreferences(storage), { startCategory: 'hires' });
  assert.equal(savePreferences(storage, { startCategory: 'instrumental', account: 'must not persist' }), true);
  assert.deepEqual(readPreferences(storage), { startCategory: 'instrumental' });
  assert.deepEqual(JSON.parse([...data.values()][0]), { startCategory: 'instrumental' });
  const before = [...data];
  for (const value of [null, {}, { startCategory: 'unknown' }, { startCategory: '__proto__' }, { startCategory: ['popular'] }]) {
    assert.equal(savePreferences(storage, value), false);
  }
  assert.deepEqual([...data], before, 'invalid choices must not overwrite the saved preference');
});

test('corrupt, restricted or full storage does not block settings or app startup', () => {
  for (const raw of ['', '{', 'null', '[]', '123', '{"startCategory":"removed-category"}']) {
    assert.deepEqual(readPreferences({ getItem: () => raw }), { startCategory: 'hires' });
  }
  assert.deepEqual(readPreferences({ getItem() { throw new Error('storage restricted'); } }), { startCategory: 'hires' });
  assert.deepEqual(readPreferences(undefined), { startCategory: 'hires' });
  assert.equal(savePreferences({ setItem() { throw new Error('quota exceeded'); } }, { startCategory: 'popular' }), false);
  assert.equal(savePreferences(undefined, { startCategory: 'popular' }), false);
});
