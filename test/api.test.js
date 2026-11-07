// End-to-end API test. Run: node --test test/
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-test-'));
const { server, db } = require('../server.js');

let base;
function client() {
  let cookie = '';
  return async (method, url, body) => {
    const res = await fetch(base + url, {
      method, headers: { 'X-VT': '1', 'Content-Type': 'application/json', cookie }, body: body === undefined ? undefined : JSON.stringify(body)
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  };
}

test('full flow', async (t) => {
  await new Promise((r) => server.listen(0, r));
  base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => server.close());

  const owner = client(), lead = client(), tech = client();
  assert.equal((await owner('GET', '/api/bootstrap')).data.setupNeeded, true);
  assert.equal((await owner('POST', '/api/setup', { name: 'Alvi Owner', email: 'owner@vaytech.test', password: 'password123' })).status, 200);
  assert.equal((await tech('POST', '/api/setup', { name: 'x', email: 'x@x.x', password: 'password123' })).status, 400, 'setup only once');

  // CSRF header required
  const noHdr = await fetch(base + '/api/logout', { method: 'POST' });
  assert.equal(noHdr.status, 403);

  // invite a lead and a tech
  const invL = await owner('POST', '/api/admin/invites', { name: 'Lena Lead', role: 'supervisor', hourly_rate: 30 });
  assert.equal(invL.status, 200);
  const tokL = invL.data.url.split('/join/')[1];
  assert.equal((await lead('POST', `/api/invite/${tokL}/accept`, { phone: '(312) 555-0100', password: 'leadpass1' })).status, 200);
  assert.equal((await lead('POST', `/api/invite/${tokL}/accept`, { phone: '3125550199', password: 'leadpass1' })).status, 404, 'invite single use');
  const leadId = db.prepare(`SELECT id FROM users WHERE role='supervisor'`).get().id;

  const invT = await owner('POST', '/api/admin/invites', { name: 'Tom Tech', role: 'tech', hourly_rate: 20, lead_id: leadId });
  const tokT = invT.data.url.split('/join/')[1];
  assert.equal((await tech('GET', `/api/invite/${tokT}`)).data.name, 'Tom Tech');
  assert.equal((await tech('POST', `/api/invite/${tokT}/accept`, { phone: '312-555-0101', password: 'short' })).status, 400);
  assert.equal((await tech('POST', `/api/invite/${tokT}/accept`, { phone: '312-555-0101', password: 'techpass1' })).status, 200);
  const techId = db.prepare(`SELECT id FROM users WHERE role='tech'`).get().id;

  // login by phone in a different format
  const tech2 = client();
  assert.equal((await tech2('POST', '/api/login', { login: '+1 312 555 0101', password: 'techpass1' })).status, 200);
  assert.equal((await tech2('POST', '/api/login', { login: '3125550101', password: 'nope' })).status, 401);

  // tech cannot see team or payroll
  assert.equal((await tech('GET', '/api/team')).status, 403);
  assert.equal((await tech('GET', '/api/admin/payroll')).status, 403);
  assert.equal((await lead('GET', '/api/admin/payroll')).status, 403, 'lead cannot see payroll');

  // clock in/out with location
  assert.equal((await tech('POST', '/api/clock/in', { lat: 41.88, lng: -87.63, acc: 12 })).status, 200);
  assert.equal((await tech('POST', '/api/clock/in', {})).status, 400, 'no double clock-in');
  let dash = (await tech('GET', '/api/me/dashboard')).data;
  assert.ok(dash.open && dash.open.in_lat === 41.88);
  assert.equal((await tech('POST', '/api/clock/out', {})).status, 200, 'clock out works without location');

  // lead sees team without pay rates
  const team = (await lead('GET', '/api/team')).data;
  const tp = team.people.find((p) => p.id === techId);
  assert.ok(tp && tp.hourly_rate === undefined && tp.week_gross === undefined, 'lead does not see pay');
  assert.ok(!team.people.some((p) => p.role === 'supervisor'), 'lead sees only techs');

  // lead fixes hours: add a shift last week (forgot to clock in)
  const s = (await owner('GET', '/api/admin/settings')).data;
  const lastWeek = (await owner('GET', '/api/admin/payroll')).data.week_start;
  const day = (n) => { const d = new Date(lastWeek + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  for (let i = 0; i < 5; i++) {
    const r = await lead('POST', `/api/team/${techId}/entries`, { clock_in: `${day(i)}T07:00`, clock_out: `${day(i)}T17:00`, reason: 'Forgot to clock in' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
  }
  assert.equal((await lead('POST', `/api/team/${techId}/entries`, { clock_in: `${day(0)}T08:00`, clock_out: `${day(0)}T09:00`, reason: 'dup' })).status, 400, 'overlap blocked');
  assert.equal((await lead('POST', `/api/team/${techId}/entries`, { clock_in: `${day(5)}T08:00`, clock_out: `${day(5)}T09:00` })).status, 400, 'reason required');
  assert.equal((await lead('POST', `/api/team/${leadId}/entries`, { clock_in: `${day(5)}T08:00`, clock_out: `${day(5)}T09:00`, reason: 'x' })).status, 403, 'lead cannot edit own hours');

  // overtime is OFF by default: 50 hours at $20 => 1000 straight time
  let pr = (await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data;
  let row = pr.rows.find((r) => r.user_id === techId);
  assert.equal(row.hours, 50); assert.equal(row.overtime, 0); assert.equal(row.gross, 1000);
  // turning overtime on => 40*20 + 10*30 = 1100; then back off
  await owner('PUT', '/api/admin/settings', { ot_enabled: true });
  row = (await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data.rows.find((r) => r.user_id === techId);
  assert.equal(row.overtime, 10); assert.equal(row.gross, 1100);
  await owner('PUT', '/api/admin/settings', { ot_enabled: false });
  assert.equal((await owner('GET', '/api/admin/settings')).data.ot_enabled, false);
  // net 30: pay date is 30 days after the week ends (then the payday weekday, if set)
  {
    const end = pr.week_end, plus = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    await owner('PUT', '/api/admin/settings', { payday_weekday: -1, pay_delay_days: 30 });
    let p2 = (await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data;
    assert.equal(p2.pay_date, plus(end, 30), 'exactly net 30');
    await owner('PUT', '/api/admin/settings', { payday_weekday: 5 });
    p2 = (await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data;
    assert.ok(p2.pay_date >= plus(end, 30) && p2.pay_date <= plus(end, 36) && new Date(p2.pay_date + 'T00:00:00Z').getUTCDay() === 5, 'next Friday on/after net 30');
    // owner moves this one week's payday; techs with unpaid hours are told
    const custom = plus(end, 10);
    const ch = await owner('POST', '/api/admin/payroll/paydate', { week_start: lastWeek, pay_date: custom });
    assert.equal(ch.status, 200); assert.equal(ch.data.pay_date, custom); assert.ok(ch.data.notified >= 1);
    assert.equal((await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data.pay_date, custom);
    assert.ok((await tech('GET', '/api/notifications')).data.items.some((n) => n.title === 'Payday changed'));
    assert.equal((await tech('GET', `/api/me/week?start=${lastWeek}`)).data.pay_date, custom, 'tech sees new payday');
    assert.equal((await owner('POST', '/api/admin/payroll/paydate', { week_start: lastWeek, pay_date: end })).status, 400, 'must be after week ends');
    assert.equal((await tech('POST', '/api/admin/payroll/paydate', { week_start: lastWeek, pay_date: custom })).status, 403, 'only the owner');
    await owner('POST', '/api/admin/payroll/paydate', { week_start: lastWeek, pay_date: null });
    assert.equal((await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data.pay_date, p2.pay_date, 'back to normal');
  }
  // different rates per person: rate set at invite is what's used
  assert.equal(db.prepare('SELECT hourly_rate FROM users WHERE id = ?').get(techId).hourly_rate, 20);
  assert.equal(db.prepare('SELECT hourly_rate FROM users WHERE id = ?').get(leadId).hourly_rate, 30);
  assert.equal(pr.pay_date > pr.week_end, true);

  // tech got notified of the hour fixes
  const notes = (await tech('GET', '/api/notifications')).data;
  assert.ok(notes.items.some((n) => n.title === 'Your hours were updated'));

  // mark paid, double pay blocked
  const todayYmd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());
  const inDays = (n) => { const d = new Date(todayYmd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const eta = inDays(3);
  assert.equal((await owner('POST', '/api/admin/payroll/mark', { user_id: techId, week_start: lastWeek, expected_amount: 999, eta })).status, 409, 'stale amount blocked');
  assert.equal((await owner('POST', '/api/admin/payroll/mark', { user_id: techId, week_start: lastWeek, expected_amount: 1000 })).status, 400, 'arrival date required');
  assert.equal((await owner('POST', '/api/admin/payroll/mark', { user_id: techId, week_start: lastWeek, expected_amount: 1000, eta: inDays(-1) })).status, 400, 'no past arrival date');
  assert.equal((await owner('POST', '/api/admin/payroll/mark', { user_id: techId, week_start: lastWeek, expected_amount: 1000, eta })).status, 200);
  assert.equal((await owner('POST', '/api/admin/payroll/mark', { user_id: techId, week_start: lastWeek, expected_amount: 1000, eta })).status, 409, 'no double pay');
  const paidNote = (await tech('GET', '/api/notifications')).data.items.find((n) => n.title === 'Payment sent');
  assert.ok(paidNote && paidNote.body.includes('$1,000.00') && /should arrive on \w{3}, \w{3} \d+/.test(paidNote.body), paidNote && paidNote.body);
  dash = (await tech('GET', '/api/me/dashboard')).data;
  assert.equal(dash.history[0].payment.amount, 1000);
  assert.equal(dash.history[0].payment.eta, eta);
  // change the arrival date later
  assert.equal((await owner('POST', '/api/admin/payroll/eta', { user_id: techId, week_start: lastWeek, eta: inDays(5) })).status, 200);
  assert.ok((await tech('GET', '/api/notifications')).data.items.some((n) => n.title === 'Pay arrival date changed'));
  assert.equal((await tech('GET', '/api/me/dashboard')).data.history[0].payment.eta, inDays(5));

  // editing a paid week flags it
  const entry = db.prepare('SELECT id FROM time_entries WHERE user_id = ? ORDER BY clock_in LIMIT 1').get(techId);
  const ed = await lead('PUT', `/api/entries/${entry.id}`, { clock_in: `${day(0)}T07:00`, clock_out: `${day(0)}T18:00`, reason: 'Stayed late' });
  assert.equal(ed.data.paid_week, lastWeek);
  pr = (await owner('GET', `/api/admin/payroll?week=${lastWeek}`)).data;
  row = pr.rows.find((r) => r.user_id === techId);
  assert.equal(row.changed, true); assert.equal(row.gross, 1020);

  // time off: needs 14 days notice
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: s.timezone }).format(new Date());
  const plus = (n) => { const d = new Date(today + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const early = await tech('POST', '/api/requests', { type: 'time_off', start_date: plus(5), end_date: plus(6) });
  assert.equal(early.status, 400); assert.match(early.data.error, /14 days/);
  const ok = await tech('POST', '/api/requests', { type: 'time_off', start_date: plus(14), end_date: plus(16), reason: 'Family trip' });
  assert.equal(ok.status, 200);
  assert.equal((await tech('POST', '/api/requests', { type: 'sick', start_date: today })).status, 200, 'sick same day ok');
  assert.ok((await lead('GET', '/api/notifications')).data.items.some((n) => /time off request/.test(n.title)), 'lead notified of request');

  // lead approves, tech notified
  const pend = (await lead('GET', '/api/team/requests')).data.items;
  assert.equal(pend.length, 2);
  assert.equal((await lead('POST', `/api/team/requests/${ok.data.id}/decide`, { status: 'approved', note: 'Have fun' })).status, 200);
  assert.equal((await lead('POST', `/api/team/requests/${ok.data.id}/decide`, { status: 'denied' })).status, 400, 'cannot decide twice');
  const ap = (await tech('GET', '/api/notifications')).data.items.find((n) => n.title === 'Time off approved');
  assert.ok(ap && ap.body.includes('Have fun'));

  // request history: who asked and when, who decided and when
  {
    const all = (await owner('GET', '/api/team/requests?status=all')).data;
    const hit = all.items.find((x) => x.id === ok.data.id);
    assert.ok(hit.created_at > 0 && hit.user_name === 'Tom Tech');
    assert.equal(hit.decided_by_name, 'Lena Lead'); assert.ok(hit.decided_at >= hit.created_at);
    assert.ok(all.items.some((x) => x.status === 'pending'), 'all includes waiting ones');
    const sickOnly = (await owner('GET', '/api/team/requests?status=all&type=sick')).data.items;
    assert.ok(sickOnly.length && sickOnly.every((x) => x.type === 'sick'));
    assert.ok((await owner('GET', `/api/team/requests?status=all&user=${techId}`)).data.items.every((x) => x.user_id === techId));
    assert.ok(all.people.some((p) => p.id === techId));
  }
  // lead's own request goes to owner, and lead can't approve it
  const lr = await lead('POST', '/api/requests', { type: 'sick', start_date: today });
  assert.equal((await lead('POST', `/api/team/requests/${lr.data.id}/decide`, { status: 'approved' })).status, 403);
  assert.equal((await owner('POST', `/api/team/requests/${lr.data.id}/decide`, { status: 'approved' })).status, 200);

  // 12-hour cap: clocked in 12h10m ago and clocks out now => exactly 12.00 hours
  {
    const { capLongShifts } = require('../server.js');
    db.prepare('DELETE FROM time_entries WHERE user_id = ? AND clock_in > ?').run(techId, Date.now() - 2 * 86400000);
    const cin = Date.now() - (12 * 60 + 10) * 60000;
    db.prepare('INSERT INTO time_entries (user_id, clock_in, created_by) VALUES (?, ?, ?)').run(techId, cin, techId);
    const out = await tech('POST', '/api/clock/out', {});
    assert.equal(out.status, 200); assert.equal(out.data.capped, true, 'late clock-out is capped');
    const e = db.prepare('SELECT * FROM time_entries WHERE user_id = ? ORDER BY clock_in DESC LIMIT 1').get(techId);
    assert.equal(e.clock_out - e.clock_in, 12 * 3600000); assert.equal(e.auto_capped, 1);
    // never clocked out at all: capped by the background check, tech + lead notified
    const cin2 = Date.now() - 20 * 3600000;
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(e.id);
    db.prepare('INSERT INTO time_entries (user_id, clock_in, created_by) VALUES (?, ?, ?)').run(techId, cin2, techId);
    assert.equal(capLongShifts(), 1);
    const e2 = db.prepare('SELECT * FROM time_entries WHERE user_id = ? ORDER BY clock_in DESC LIMIT 1').get(techId);
    assert.equal(e2.clock_out - e2.clock_in, 12 * 3600000);
    assert.ok((await tech('GET', '/api/notifications')).data.items.some((n) => n.title === 'Shift ended automatically'));
    assert.ok((await lead('GET', '/api/notifications')).data.items.some((n) => /shift ended automatically/.test(n.title)));
    // a normal 8 hour shift is not touched
    db.prepare('INSERT INTO time_entries (user_id, clock_in, created_by) VALUES (?, ?, ?)').run(techId, Date.now() - 8 * 3600000, techId);
    assert.equal(capLongShifts(), 0);
    assert.equal((await tech('POST', '/api/clock/out', {})).data.capped, undefined);
  }

  // turning off an account signs them out
  await owner('PUT', `/api/admin/people/${techId}`, { name: 'Tom Tech', role: 'tech', hourly_rate: 20, lead_id: leadId, active: false });
  assert.equal((await tech('GET', '/api/me/dashboard')).status, 401);

  // CSV export
  const csv = await owner('GET', `/api/admin/payroll.csv?week=${lastWeek}`);
  assert.match(csv.data, /Tom Tech,tech/);
});
