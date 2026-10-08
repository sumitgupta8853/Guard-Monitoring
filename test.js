// End-to-end test of the whole flow:
// admin creates site + guard -> guard logs in -> photo check-in (blocked outside the area)
// -> leaves the radius (alerts) -> returns -> check-out -> admin sees the report.
const { spawn } = require('child_process');
const { io } = require('socket.io-client');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 3999, BASE = `http://localhost:${PORT}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-test-'));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, url, { token, json, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let body;
  if (json) { headers['content-type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(BASE + url, { method, headers, body });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, type, body: type.includes('json') ? await res.json() : null };
}
function photoForm(fields = {}, withPhoto = true) {
  const f = new FormData();
  if (withPhoto) f.append('photo', new Blob([PNG], { type: 'image/png' }), 'selfie.png');
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  return f;
}

const results = [];
const check = (name, ok) => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`); };

// Site: center + 100 m radius. 0.0001 degrees of latitude is about 11.1 m.
const C = { lat: 24.8607, lng: 67.0011 };
const at = (dLat) => ({ lat: C.lat + dLat, lng: C.lng, accuracy: 10 });

(async () => {
  const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/guard-monitor-test';
  const proc = spawn('node', ['src/server.js'], {
    env: { ...process.env, PORT, DATA_DIR: dir, UPLOAD_DIR: dir, MONGO_URI, ADMIN_USER: 'admin', ADMIN_PASS: 'adminpass1', JWT_SECRET: 'test-secret' },
    stdio: 'inherit',
  });
  await sleep(2500);
  try {
    // ----- admin -----
    const adminLogin = await api('POST', '/api/auth/login', { json: { username: 'admin', password: 'adminpass1' } });
    check('admin can log in', adminLogin.status === 200 && adminLogin.body.role === 'admin');
    const A = adminLogin.body.token;
    check('wrong password rejected', (await api('POST', '/api/auth/login', { json: { username: 'admin', password: 'nope' } })).status === 401);

    const site = (await api('POST', '/api/admin/sites', { token: A, json: { name: 'Warehouse', ...C, radiusMeters: 100 } })).body;
    check('admin creates site', !!site.id);

    const g1 = (await api('POST', '/api/admin/guards', { token: A, json: {
      name: 'Ali Khan', username: 'ali', password: 'secret123', phone: '0300-1234567', cnic: '42101-1234567-1',
      address: 'Karachi', emergencyContact: '0301-7654321', siteId: site.id, shift: { start: '00:00', end: '23:59' } } })).body;
    check('admin creates guard profile', !!g1.id && g1.username === 'ali');
    check('duplicate username rejected', (await api('POST', '/api/admin/guards', { token: A, json: { name: 'X', username: 'ali', password: 'secret123', siteId: site.id } })).status === 409);
    const g2 = (await api('POST', '/api/admin/guards', { token: A, json: { name: 'Bilal', username: 'bilal', password: 'secret123', siteId: site.id } })).body;

    const prof = await api('POST', `/api/admin/guards/${g1.id}/photo`, { token: A, form: photoForm() });
    check('admin uploads guard profile photo', prof.status === 200 && !!prof.body.profilePhotoUrl);

    // ----- guard -----
    const G = (await api('POST', '/api/auth/login', { json: { username: 'ali', password: 'secret123' } })).body.token;
    const G2 = (await api('POST', '/api/auth/login', { json: { username: 'bilal', password: 'secret123' } })).body.token;
    const me = await api('GET', '/api/guard/me', { token: G });
    check('guard sees own profile and site', me.body.profile.name === 'Ali Khan' && me.body.site.radiusMeters === 100 && me.body.onDuty === false);
    check('guard cannot use admin API', (await api('GET', '/api/admin/guards', { token: G })).status === 403);

    // sockets
    const alerts = [], warnings = [];
    const adminSock = io(BASE, { auth: { token: A } });
    const guardSock = io(BASE, { auth: { token: G } });
    adminSock.on('alert', (a) => alerts.push(a.type));
    guardSock.on('warning', (w) => warnings.push(w));
    await sleep(400);

    // ----- attendance rules -----
    check('location before check-in rejected', (await api('POST', '/api/guard/location', { token: G, json: at(0) })).status === 409);
    check('check-in without photo rejected', (await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm(at(0), false) })).status === 400);
    const far = await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm(at(0.003)) });
    check('check-in outside the area blocked', far.status === 403 && far.body.distanceMeters > 300);
    check('fake GPS check-in blocked', (await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm({ ...at(0), mocked: true }) })).status === 403);

    const ci = await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm(at(0.0003)) });
    check('check-in with photo inside the area starts attendance', ci.status === 201 && !!ci.body.checkInPhotoUrl);
    const attId = ci.body.id;
    check('double check-in rejected', (await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm(at(0)) })).status === 409);

    // ----- geofence -----
    const p1 = await api('POST', '/api/guard/location', { token: G, json: at(0.0002) });
    check('inside ping is fine', p1.body.zone === 'inside');
    const p2 = await api('POST', '/api/guard/location', { token: G, json: at(0.0030) });
    check('1st outside ping: no alert yet (GPS jitter filter)', p2.body.zone === 'inside');
    const p3 = await api('POST', '/api/guard/location', { token: G, json: at(0.0031) });
    check('2nd outside ping: guard flagged outside with warning', p3.body.zone === 'outside' && !!p3.body.warning);
    check('check-out blocked while outside', (await api('POST', '/api/guard/attendance/check-out', { token: G, form: photoForm(at(0.0031)) })).status === 403);
    await sleep(1100);
    const p4 = await api('POST', '/api/guard/location', { token: G, json: at(0.0002) });
    check('returning inside clears the violation', p4.body.zone === 'inside');
    await sleep(300);
    check('admin received LEFT_AREA then RETURNED', alerts.filter((t) => t === 'LEFT_AREA' || t === 'RETURNED').join() === 'LEFT_AREA,RETURNED');
    check('guard received a live warning', warnings.length === 1);

    // ----- privacy of photos -----
    const photoUrl = ci.body.checkInPhotoUrl;
    const asAdmin = await fetch(BASE + photoUrl, { headers: { authorization: `Bearer ${A}` } });
    check('admin can view attendance photo', asAdmin.status === 200 && (asAdmin.headers.get('content-type') || '').includes('image/png'));
    check("another guard cannot view it", (await fetch(BASE + photoUrl, { headers: { authorization: `Bearer ${G2}` } })).status === 403);
    check('no token cannot view it', (await fetch(BASE + photoUrl)).status === 401);

    // ----- check-out and report -----
    const co = await api('POST', '/api/guard/attendance/check-out', { token: G, form: photoForm(at(0.0001)) });
    check('check-out inside the area works', co.status === 200 && !!co.body.checkOutAt);
    check('violation recorded on attendance', co.body.violations.length === 1 && co.body.outsideSeconds >= 1);
    check('location after check-out rejected', (await api('POST', '/api/guard/location', { token: G, json: at(0) })).status === 409);
    check('second check-in same day rejected', (await api('POST', '/api/guard/attendance/check-in', { token: G, form: photoForm(at(0)) })).status === 409);

    const report = await api('GET', `/api/admin/attendance?guardId=${g1.id}`, { token: A });
    check('admin attendance report shows the record', report.body.length === 1 && report.body[0].id === attId && report.body[0].guardName === 'Ali Khan');
    const trail = await api('GET', `/api/admin/attendance/${attId}/trail`, { token: A });
    check('admin can see the location trail', trail.body.length === 4);
    const dash = await api('GET', '/api/admin/dashboard', { token: A });
    check('dashboard counts', dash.body.guardsTotal === 2 && dash.body.onDuty === 0 && dash.body.checkedInToday === 1);

    // deactivated guard cannot log in or use old token
    await api('DELETE', `/api/admin/guards/${g2.id}`, { token: A });
    check('deactivated guard blocked', (await api('GET', '/api/guard/me', { token: G2 })).status === 401);

    adminSock.close(); guardSock.close();
  } catch (e) {
    console.error('Test crashed:', e);
    results.push(false);
  }
  proc.kill('SIGTERM');
  await sleep(300);
  const failed = results.filter((r) => !r).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
})();
