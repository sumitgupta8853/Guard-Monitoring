// Push API test: token register -> status -> test-send (no FCM keys,
// so sends resolve disabled but must NOT crash) -> remove -> alert still works.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3998, BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-push-test-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, json } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  const res = await fetch(BASE + url, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : null };
}

const results = [];
const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

(async () => {
  const MONGO_URI = 'mongodb://localhost:27017/guard-push-test';
  const proc = spawn('node', ['src/server.js'], {
    cwd: __dirname,
    env: {
      ...process.env, PORT, DATA_DIR: dir, UPLOAD_DIR: dir, MONGO_URI,
      ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass1', JWT_SECRET: 'test-secret',
    },
    stdio: 'inherit',
  });
  await sleep(2500);
  try {
    const A = (await api('POST', '/api/auth/login', { json: { username: 'admin', password: 'adminpass1' } })).body.token;
    check('admin login', !!A);

    const site = (await api('POST', '/api/admin/sites', { token: A, json: { name: 'S', lat: 24.86, lng: 67.0, radiusMeters: 100 } })).body;
    const g = (await api('POST', '/api/admin/guards', {
      token: A, json: { name: 'Push Guard', username: 'pushg', password: 'secret123', siteId: site.id, shift: { start: '00:00', end: '23:59' } },
    })).body;
    const G = (await api('POST', '/api/auth/login', { json: { username: 'pushg', password: 'secret123' } })).body.token;
    check('guard login', !!G);

    // unauthenticated push calls rejected
    check('push register needs auth', (await api('POST', '/api/push/token', { json: { token: 'x'.repeat(20) } })).status === 401);
    // validation
    check('push register rejects short token', (await api('POST', '/api/push/token', { token: G, json: { token: 'short' } })).status === 400);
    check('push register rejects bad platform', (await api('POST', '/api/push/token', { token: G, json: { token: 'd'.repeat(40), platform: 'winphone' } })).status === 400);

    // guard registers a device (token rotation via deviceId)
    const fake = 'f'.repeat(140);
    const r1 = await api('POST', '/api/push/token', { token: G, json: { token: fake, platform: 'android', deviceId: 'dev-1' } });
    check('guard registers token', r1.status === 200 && r1.body.ok === true);
    const rotated = 'e'.repeat(140);
    const r2 = await api('POST', '/api/push/token', { token: G, json: { token: rotated, platform: 'android', deviceId: 'dev-1' } });
    check('token rotation replaces row (no dup)', r2.status === 200);
    const st = await api('GET', '/api/push/status', { token: G });
    check('status shows 1 device', st.status === 200 && st.body.devices === 1);

    // admin registers a device too
    const ar = await api('POST', '/api/push/token', { token: A, json: { token: 'a'.repeat(140), platform: 'web' } });
    check('admin registers token', ar.status === 200);

    // guard cannot use admin test endpoint
    check('guard blocked from admin push test', (await api('POST', '/api/admin/push/test', { token: G, json: {} })).status === 403);
    // admin test send works (disabled without FCM keys, must not crash)
    const t = await api('POST', '/api/admin/push/test', { token: A, json: { title: 'Hi', body: 'hello' } });
    check('admin test push responds', t.status === 200 && t.body.ok === true);
    check('push disabled flag reported', t.body.pushEnabled === false);
    const t2 = await api('POST', '/api/admin/push/test', { token: A, json: { title: 'Hi', body: 'hello', guardId: g.id } });
    check('admin test push to guard responds', t2.status === 200 && t2.body.ok === true);
    check('admin test push bad guard 404', (await api('POST', '/api/admin/push/test', { token: A, json: { guardId: '000000000000000000000000' } })).status === 404);
    check('broadcast needs title+body', (await api('POST', '/api/admin/push/send', { token: A, json: {} })).status === 400);
    const b = await api('POST', '/api/admin/push/send', { token: A, json: { title: 'Shift', body: 'Be on time', guardIds: [g.id] } });
    check('broadcast responds', b.status === 200 && b.body.ok === true);

    // remove token
    const del = await api('DELETE', '/api/push/token', { token: G, json: { deviceId: 'dev-1' } });
    check('token removed', del.status === 200 && del.body.removed === 1);
    const st2 = await api('GET', '/api/push/status', { token: G });
    check('status shows 0 devices', st2.status === 200 && st2.body.devices === 0);
    check('remove without id 400', (await api('DELETE', '/api/push/token', { token: G, json: {} })).status === 400);
  } catch (e) {
    console.error('Push test crashed:', e);
    results.push(false);
  }
  proc.kill('SIGTERM');
  await sleep(800);
  const n = results.filter(Boolean).length;
  console.log(`\n${n}/${results.length} push checks passed`);
  process.exit(n === results.length ? 0 : 1);
})();
