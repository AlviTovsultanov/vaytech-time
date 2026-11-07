/* VayTech Time — DEMO backend. Runs the app's API inside the browser on sample data.
   The real app uses server.js; this file is only for the demo page. */
(() => {
  'use strict';
  /*@@TZ_HELPERS@@*/
  const KEY = 'vt_demo_v5';
  const round2 = (n) => Math.round(n * 100) / 100;
  const DAY = 86400000, HOUR = 3600000;

  /* ---------- state ---------- */
  let D = null;
  function save() { try { localStorage.setItem(KEY, JSON.stringify(D)); } catch {} }
  function load() { try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {} return null; }
  const nextId = () => ++D.seq;

  function seed() {
    const tz = 'America/Chicago';
    D = {
      seq: 100, session: null, ts: Date.now(),
      settings: { company_name: 'VayTech', timezone: tz, week_start_day: 0, ot_enabled: false, ot_threshold: 40, ot_multiplier: 1.5, payday_weekday: -1, pay_delay_days: 30, timeoff_notice_days: 14, max_shift_hours: 12 },
      users: [], invites: [], entries: [], edits: [], requests: [], payments: [], notifications: []
    };
    const s = D.settings;
    const mk = (name, role, rate, lead, phone) => { const u = { id: nextId(), name, role, hourly_rate: rate, lead_id: lead, phone, email: null, password: 'demo1234', active: 1, created_at: Date.now() - 60 * DAY }; D.users.push(u); return u; };
    const owner = mk('Alvi Tovsultanov', 'owner', 0, null, '3125550001'); owner.email = 'owner@vaytech.demo';
    const marcus = mk('Marcus Reyes', 'supervisor', 32, null, '3125550100');
    const sarah = mk('Sarah Kim', 'supervisor', 30, null, '3125550110');
    const techs = [
      mk('Danny Cole', 'tech', 22.5, marcus.id, '3125550101'),
      mk('Jose Martinez', 'tech', 26, marcus.id, '3125550102'),
      mk('Kevin Brooks', 'tech', 20, marcus.id, '3125550103'),
      mk('Luis Ortega', 'tech', 24, sarah.id, '3125550104'),
      mk('Ahmed Saidov', 'tech', 21, sarah.id, '3125550105'),
      mk('Tyler Grant', 'tech', 19, sarah.id, '3125550106')
    ];
    const workers = [marcus, sarah, ...techs];
    const sites = [[41.8781, -87.6298], [41.9742, -87.9073], [41.7508, -87.7124], [42.0451, -87.6877], [41.8500, -88.3126]];
    const today = ymdOf(Date.now(), tz);
    const thisWeek = weekStartOf(today, s);
    // deterministic pseudo-random
    let r = 7; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
    const at = (ymd, h, m) => { const p = parseYmd(ymd); return zonedToUtc(p.y, p.m, p.d, h, m, tz); };
    for (let w = 7; w >= 0; w--) {
      const ws = addDays(thisWeek, -7 * w);
      workers.forEach((u, ui) => {
        for (let d = 0; d < 6; d++) {
          const day = addDays(ws, d);
          if (day >= today) continue;
          if (d === 5 && rnd() < 0.6) continue; // most Saturdays off
          if (rnd() < 0.06) continue; // occasional day off
          const site = sites[(ui + d) % sites.length];
          const inH = 6 + Math.floor(rnd() * 2), inM = Math.floor(rnd() * 4) * 15;
          const len = 7.5 + rnd() * 3;
          const cin = at(day, inH, inM), cout = cin + Math.round(len * 4) / 4 * HOUR;
          D.entries.push({ id: nextId(), user_id: u.id, clock_in: cin, clock_out: cout, in_lat: site[0] + rnd() * 0.004, in_lng: site[1] + rnd() * 0.004, in_acc: 12, out_lat: site[0], out_lng: site[1], out_acc: 15, created_by: u.id, edited: 0 });
        }
      });
    }
    // two people on the clock right now
    [techs[0], techs[3]].forEach((u, i) => { const site = sites[i]; D.entries.push({ id: nextId(), user_id: u.id, clock_in: Math.min(Date.now() - 5 * 60000, at(today, 7, i * 20)), clock_out: null, in_lat: site[0], in_lng: site[1], in_acc: 10, created_by: u.id, edited: 0 }); });
    // weeks whose net-30 pay date has passed are already paid
    for (let w = 1; w <= 7; w++) {
      const ws = addDays(thisWeek, -7 * w);
      if (payDateFor(ws, s) >= today) continue;
      for (const u of workers) {
        const sum = weekSummary(u, ws, s);
        if (sum.gross > 0) {
          const paidAt = at(payDateFor(ws, s), 9, 30);
          const eta = addDays(payDateFor(ws, s), 1);
          D.payments.push({ id: nextId(), user_id: u.id, week_start: ws, hours: sum.hours, ot_hours: 0, rate: u.hourly_rate, amount: sum.gross, paid_at: paidAt, paid_by: owner.id, eta });
          notifyAt(u.id, 'Payment sent', `Your pay of ${money(sum.gross)} for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} (${sum.hours} hrs) has been sent. It should arrive on ${niceDate(eta)}.`, paidAt);
        }
      }
    }
    // requests
    const req = (u, type, a, b, reason, status, by, note) => { const q = { id: nextId(), user_id: u.id, type, start_date: a, end_date: b, reason, status: status || 'pending', decided_by: by ? by.id : null, decided_at: by ? Date.now() - 2 * DAY : null, decision_note: note || '', created_at: Date.now() - (status ? 4 : 0.2) * DAY }; D.requests.push(q); return q; };
    req(techs[1], 'time_off', addDays(today, 20), addDays(today, 22), 'Family wedding in Houston');
    req(techs[2], 'sick', today, today, 'Fever, staying home');
    // Luis forgot to clock out yesterday: the app cut it at 12 hours
    { const y = addDays(today, -1); D.entries = D.entries.filter((e) => !(e.user_id === techs[3].id && ymdOf(e.clock_in, tz) === y));
      const cin = at(y, 7, 0); D.entries.push({ id: nextId(), user_id: techs[3].id, clock_in: cin, clock_out: cin + 12 * HOUR, in_lat: sites[3][0], in_lng: sites[3][1], in_acc: 10, created_by: techs[3].id, edited: 0, auto_capped: 1 });
      D.edits.push({ id: nextId(), entry_id: D.seq, user_id: techs[3].id, editor_id: techs[3].id, action: 'auto', reason: 'Never clocked out. App ended the shift at 12 hours.', at: cin + 12 * HOUR });
      notifyAt(techs[3].id, 'Shift ended automatically', `You were on the clock 12 hours (since ${niceTime(cin, tz)}), so the app ended your shift at ${niceTime(cin + 12 * HOUR, tz)}. If you left earlier, send a Fix my hours request.`, cin + 12 * HOUR);
      notifyAt(sarah.id, "Luis Ortega's shift ended automatically", `Luis Ortega clocked in ${niceTime(cin, tz)} and never clocked out. The app counted 12 hours. Check with them and fix it if needed.`, cin + 12 * HOUR); }
    req(techs[3], 'correction', addDays(today, -1), addDays(today, -1), 'Forgot to clock out yesterday. App counted 12 hours but I left the job at 4:00 PM');
    req(techs[0], 'time_off', addDays(today, 30), addDays(today, 30), 'Doctor appointment', 'approved', marcus, 'No problem');
    req(techs[4], 'time_off', addDays(today, 16), addDays(today, 19), 'Trip', 'denied', sarah, 'Big install that week, can we move it?');
    notifyAt(techs[0].id, 'Time off approved', `Marcus Reyes approved your request for ${niceDate(addDays(today, 30))}. Note: No problem`, Date.now() - 2 * DAY);
    notifyAt(marcus.id, 'New time off request', `Jose Martinez: ${niceDate(addDays(today, 20))} – ${niceDate(addDays(today, 22))} — Family wedding in Houston`, Date.now() - 0.2 * DAY);
    notifyAt(marcus.id, 'New sick leave request', `Kevin Brooks: ${niceDate(today)} — Fever, staying home`, Date.now() - 0.1 * DAY);
    notifyAt(sarah.id, 'New hours fix request', `Luis Ortega: ${niceDate(addDays(today, -1))} — Forgot to clock out yesterday, left the job at 4:00 PM`, Date.now() - 0.1 * DAY);
    D.session = owner.id;
    save();
  }

  /* ---------- helpers mirroring server.js ---------- */
  const S = () => D.settings;
  const payDateOf = (ws, s) => (D.payOverrides && D.payOverrides[ws]) || payDateFor(ws, s);
  const userById = (id) => D.users.find((u) => u.id === Number(id));
  function weekSummary(user, weekStart, s, now = Date.now()) {
    const from = midnightUtc(weekStart, s.timezone), to = midnightUtc(addDays(weekStart, 7), s.timezone);
    const entries = D.entries.filter((e) => e.user_id === user.id && e.clock_in < to && (e.clock_out ?? now) > from).sort((a, b) => a.clock_in - b.clock_in);
    let ms = 0; const days = {};
    for (let i = 0; i < 7; i++) days[addDays(weekStart, i)] = 0;
    for (const e of entries) {
      const a = Math.max(e.clock_in, from), b = Math.min(e.clock_out ?? now, to);
      if (b > a) { ms += b - a; const day = ymdOf(a, s.timezone); if (day in days) days[day] += (b - a) / HOUR; }
    }
    const hours = round2(ms / HOUR);
    const regular = s.ot_enabled ? round2(Math.min(hours, s.ot_threshold)) : hours;
    const overtime = s.ot_enabled ? round2(Math.max(0, hours - s.ot_threshold)) : 0;
    const rate = user.hourly_rate || 0;
    const gross = round2(regular * rate + overtime * rate * s.ot_multiplier);
    const p = D.payments.find((x) => x.user_id === user.id && x.week_start === weekStart);
    const payment = p ? { ...p, paid_by_name: (userById(p.paid_by) || {}).name } : null;
    return { week_start: weekStart, week_end: addDays(weekStart, 6), pay_date: payDateOf(weekStart, s), pay_date_custom: !!(D.payOverrides && D.payOverrides[weekStart]), normal_pay_date: payDateFor(weekStart, s), hours, regular, overtime, rate, gross, days: Object.entries(days).map(([date, h]) => ({ date, hours: round2(h) })), open: entries.some((e) => !e.clock_out), entries: entries.map((e) => ({ ...e })), payment };
  }
  function money(n) { return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function niceDate(ymd) { const p = parseYmd(ymd); return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }); }
  function niceTime(ms, tz) { return new Date(ms).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  function notifyAt(userId, title, body, at) { D.notifications.push({ id: nextId(), user_id: userId, title, body: body || '', created_at: at || Date.now(), read_at: null }); }
  const notify = (u, t, b) => notifyAt(u, t, b, Date.now());
  function approversFor(user) {
    if (user.role === 'supervisor') return D.users.filter((u) => u.role === 'owner' && u.active).map((u) => u.id);
    if (user.lead_id) { const l = userById(user.lead_id); if (l && l.active) return [l.id]; }
    return D.users.filter((u) => (u.role === 'owner' || u.role === 'supervisor') && u.active).map((u) => u.id);
  }
  function publicUser(u, viewer) {
    if (!u) return null;
    const out = { id: u.id, name: u.name, role: u.role, phone: u.phone, email: u.email, lead_id: u.lead_id, active: !!u.active };
    if (viewer && (viewer.role === 'owner' || viewer.id === u.id)) out.hourly_rate = u.hourly_rate;
    return out;
  }
  class HttpError extends Error { constructor(st, m) { super(m); this.status = st; } }
  const fail = (st, m) => { throw new HttpError(st, m); };
  const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (d.length === 11 && d.startsWith('1')) d = d.slice(1); return d || null; };
  const normEmail = (e) => { const v = String(e || '').trim().toLowerCase(); return v || null; };
  function canManage(viewer, t) { if (!t) return false; if (viewer.role === 'owner') return t.role !== 'owner'; if (viewer.role === 'supervisor') return t.role === 'tech'; return false; }
  const openEntry = (uid) => D.entries.filter((e) => e.user_id === uid && !e.clock_out).sort((a, b) => b.clock_in - a.clock_in)[0];
  const TYPE_LABEL = { time_off: 'Time off', sick: 'Sick leave', correction: 'Hours fix' };
  const withLabel = (r) => ({ ...r, type_label: TYPE_LABEL[r.type], decided_by_name: r.decided_by ? (userById(r.decided_by) || {}).name : null, user_name: (userById(r.user_id) || {}).name, lead_id: (userById(r.user_id) || {}).lead_id });
  const token = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
  const inviteUrl = (t) => 'https://time.vaytech.org/join/' + t; // what a real invite link looks like
  function validLead(id) { if (!id) return null; const l = userById(id); if (!l || (l.role !== 'owner' && l.role !== 'supervisor')) fail(400, 'Pick a valid team lead'); return l.id; }

  /* ---------- routes ---------- */
  const routes = [];
  const route = (method, pattern, opts, fn) => { const keys = []; const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$'); routes.push({ method, re, keys, opts, fn }); };

  route('GET', '/api/bootstrap', {}, ({ user }) => ({ setupNeeded: false, user: publicUser(user, user), settings: { company_name: S().company_name, timezone: S().timezone, timeoff_notice_days: S().timeoff_notice_days } }));
  route('POST', '/api/login', {}, ({ body }) => {
    const login = str(body.login, 120);
    const u = login.includes('@') ? D.users.find((x) => x.email === normEmail(login)) : D.users.find((x) => x.phone === normPhone(login));
    if (!u || u.password !== String(body.password || '')) fail(401, 'Wrong phone/email or password');
    if (!u.active) fail(403, 'This account is turned off. Talk to your supervisor.');
    D.session = u.id; return { ok: true };
  });
  route('POST', '/api/logout', {}, () => { D.session = null; return { ok: true }; });
  const loadInvite = (t) => { const i = D.invites.find((x) => x.token === t); if (!i || i.revoked || i.used_at) fail(404, 'This link has already been used or was cancelled. Ask for a new one.'); if (i.expires_at < Date.now()) fail(410, 'This link has expired.'); return i; };
  route('GET', '/api/invite/:t', {}, ({ params }) => { const i = loadInvite(params.t); const u = i.user_id ? userById(i.user_id) : null; return { kind: i.kind, name: u ? u.name : i.name, role: i.role, company: S().company_name }; });
  route('POST', '/api/invite/:t/accept', {}, ({ params, body }) => {
    const i = loadInvite(params.t);
    const pw = String(body.password || '');
    if (pw.length < 8) fail(400, 'Password must be at least 8 characters');
    if (i.kind === 'reset') { userById(i.user_id).password = pw; i.used_at = Date.now(); D.session = i.user_id; return { ok: true }; }
    const phone = normPhone(body.phone), email = normEmail(body.email), name = str(body.name, 80) || i.name;
    if (!phone || phone.length < 10) fail(400, 'Enter a full phone number');
    if (D.users.some((u) => u.phone === phone)) fail(400, 'That phone number already has an account. Sign in instead.');
    if (email && D.users.some((u) => u.email === email)) fail(400, 'That email already has an account.');
    const u = { id: nextId(), name, phone, email, password: pw, role: i.role, hourly_rate: i.hourly_rate, lead_id: i.lead_id, active: 1, created_at: Date.now() };
    D.users.push(u); i.used_at = Date.now(); i.user_id = u.id;
    notify(i.created_by, `${name} joined`, `${name} created their account and can now clock in.`);
    D.session = u.id; return { ok: true };
  });

  route('GET', '/api/me/dashboard', { auth: true }, ({ user }) => {
    const s = S(), ws = currentWeekStart(s), week = weekSummary(user, ws, s), history = [];
    for (let i = 1; i <= 8; i++) { const w = weekSummary(user, addDays(ws, -7 * i), s); if (w.hours > 0 || w.payment) history.push({ week_start: w.week_start, week_end: w.week_end, pay_date: w.pay_date, hours: w.hours, overtime: w.overtime, gross: w.gross, payment: w.payment && { amount: w.payment.amount, paid_at: w.payment.paid_at, eta: w.payment.eta } }); }
    return { open: openEntry(user.id) || null, week, history, settings: { ot_enabled: s.ot_enabled, ot_threshold: s.ot_threshold, ot_multiplier: s.ot_multiplier, max_shift_hours: s.max_shift_hours } };
  });
  route('GET', '/api/me/week', { auth: true }, ({ user, query }) => { const s = S(); return weekSummary(user, parseYmd(query.start) ? weekStartOf(query.start, s) : currentWeekStart(s), s); });
  const loc = (b) => { const lat = num(b.lat), lng = num(b.lng); return lat === null || lng === null ? [null, null, null] : [lat, lng, num(b.acc)]; };
  route('POST', '/api/clock/in', { auth: true }, ({ user, body }) => {
    if (user.role === 'owner') fail(400, 'The owner account does not clock in. Switch to a tech or lead at the top to try clocking in.');
    if (openEntry(user.id)) fail(400, 'You are already clocked in');
    const [lat, lng, acc] = loc(body);
    D.entries.push({ id: nextId(), user_id: user.id, clock_in: Date.now(), clock_out: null, in_lat: lat, in_lng: lng, in_acc: acc, created_by: user.id, edited: 0 }); return { ok: true };
  });
  function capLongShifts() {
    const s = S(); if (!(s.max_shift_hours > 0)) return;
    const limit = s.max_shift_hours * HOUR;
    const due = D.entries.filter((x) => !x.clock_out && x.clock_in <= Date.now() - limit);
    for (const e of due) {
      const u = userById(e.user_id), end = e.clock_in + limit;
      Object.assign(e, { clock_out: end, auto_capped: 1 });
      recordEdit(e.id, u.id, u.id, 'auto', { clock_in: e.clock_in, clock_out: null }, { clock_in: e.clock_in, clock_out: end }, `Never clocked out. App ended the shift at ${s.max_shift_hours} hours.`);
      notify(u.id, 'Shift ended automatically', `You were on the clock ${s.max_shift_hours} hours (since ${niceTime(e.clock_in, s.timezone)}), so the app ended your shift at ${niceTime(end, s.timezone)}. If you left earlier, send a Fix my hours request.`);
      for (const id of approversFor(u)) notify(id, `${u.name}'s shift ended automatically`, `${u.name} clocked in ${niceTime(e.clock_in, s.timezone)} and never clocked out. The app counted ${s.max_shift_hours} hours. Check with them and fix it if needed.`);
    }  if (due.length) save();
  }
  route('POST', '/api/clock/out', { auth: true }, ({ user, body }) => {
    const e = openEntry(user.id);
    if (!e) { const last = D.entries.filter((x) => x.user_id === user.id).sort((a, b) => b.clock_in - a.clock_in)[0]; if (last && last.auto_capped && Date.now() - last.clock_out < 36 * HOUR) return { ok: true, capped: true, hours: S().max_shift_hours }; fail(400, 'You are not clocked in'); }
    const [lat, lng, acc] = loc(body); Object.assign(e, { clock_out: Math.max(Date.now(), e.clock_in + 1000), out_lat: lat, out_lng: lng, out_acc: acc }); return { ok: true };
  });
  const myNotes = (u) => D.notifications.filter((n) => n.user_id === u.id).sort((a, b) => b.created_at - a.created_at);
  route('GET', '/api/notifications', { auth: true }, ({ user }) => ({ items: myNotes(user).slice(0, 50), unread: myNotes(user).filter((n) => !n.read_at).length }));
  route('GET', '/api/notifications/count', { auth: true }, ({ user }) => ({ unread: myNotes(user).filter((n) => !n.read_at).length }));
  route('POST', '/api/notifications/read', { auth: true }, ({ user }) => { myNotes(user).forEach((n) => { if (!n.read_at) n.read_at = Date.now(); }); return { ok: true }; });

  route('GET', '/api/requests', { auth: true }, ({ user }) => ({ items: D.requests.filter((r) => r.user_id === user.id).sort((a, b) => b.created_at - a.created_at).map(withLabel) }));
  route('POST', '/api/requests', { auth: true }, ({ user, body }) => {
    if (user.role === 'owner') fail(400, 'The owner account does not send requests. Switch to a tech at the top to try it.');
    const s = S(), type = String(body.type);
    if (!TYPE_LABEL[type]) fail(400, 'Pick a request type');
    const start = String(body.start_date || ''), end = String(body.end_date || body.start_date || '');
    if (!parseYmd(start) || !parseYmd(end)) fail(400, 'Pick the date(s)');
    if (end < start) fail(400, 'End date is before start date');
    const today = ymdOf(Date.now(), s.timezone), reason = str(body.reason, 1000);
    if (type === 'time_off') { const earliest = addDays(today, s.timeoff_notice_days); if (start < earliest) fail(400, `Time off must be requested at least ${s.timeoff_notice_days} days ahead. Earliest date: ${niceDate(earliest)}.`); }
    if (type === 'correction') { if (start > today) fail(400, 'Pick the day that needs fixing'); if (!reason) fail(400, 'Tell your lead what needs fixing'); }
    const r = { id: nextId(), user_id: user.id, type, start_date: start, end_date: end, reason, status: 'pending', decided_by: null, decided_at: null, decision_note: '', created_at: Date.now() };
    D.requests.push(r);
    const range = start === end ? niceDate(start) : `${niceDate(start)} – ${niceDate(end)}`;
    for (const id of approversFor(user)) notify(id, `New ${TYPE_LABEL[type].toLowerCase()} request`, `${user.name}: ${range}${reason ? ' — ' + reason : ''}`);
    return { ok: true, id: r.id };
  });
  route('POST', '/api/requests/:id/cancel', { auth: true }, ({ user, params }) => { const r = D.requests.find((x) => x.id === Number(params.id) && x.user_id === user.id); if (!r) fail(404, 'Not found'); if (r.status !== 'pending') fail(400, 'Only pending requests can be cancelled'); r.status = 'cancelled'; return { ok: true }; });

  const teamOf = (v) => D.users.filter((u) => (v.role === 'owner' ? u.role !== 'owner' : u.role === 'tech')).sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
  route('GET', '/api/team', { auth: true, roles: ['owner', 'supervisor'] }, ({ user }) => {
    const s = S(), ws = currentWeekStart(s);
    const people = teamOf(user).map((u) => { const w = weekSummary(u, ws, s); const o = { ...publicUser(u, user), week_hours: w.hours, week_overtime: w.overtime, open: openEntry(u.id) || null }; if (user.role === 'owner') o.week_gross = w.gross; return o; });
    return { people, leads: D.users.filter((u) => u.role !== 'tech' && u.active).map((u) => ({ id: u.id, name: u.name })), me: user.id };
  });
  const getManaged = (v, id) => { const t = userById(id); if (!canManage(v, t)) fail(403, 'Not allowed'); return t; };
  route('GET', '/api/team/:id/week', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, params, query }) => {
    const s = S(), t = getManaged(user, params.id), start = parseYmd(query.start) ? weekStartOf(query.start, s) : currentWeekStart(s);
    const w = weekSummary(t, start, s);
    const edits = D.edits.filter((e) => e.user_id === t.id).sort((a, b) => b.at - a.at).slice(0, 50).map((e) => ({ ...e, editor_name: (userById(e.editor_id) || {}).name }));
    if (user.role !== 'owner') { delete w.rate; delete w.gross; delete w.payment; }
    return { person: publicUser(t, user), week: w, edits };
  });
  function validateTimes(body, s) {
    const cin = parseLocalDateTime(body.clock_in, s.timezone); if (!cin) fail(400, 'Enter a clock-in time');
    let cout = null;
    if (body.clock_out) { cout = parseLocalDateTime(body.clock_out, s.timezone); if (!cout) fail(400, 'Clock-out time is not valid'); if (cout <= cin) fail(400, 'Clock-out must be after clock-in'); if (cout - cin > 24 * HOUR) fail(400, 'A single shift cannot be longer than 24 hours'); }
    if (cin > Date.now() + 300000) fail(400, 'Clock-in cannot be in the future');
    if (cout && cout > Date.now() + 300000) fail(400, 'Clock-out cannot be in the future');
    return [cin, cout];
  }
  function checkOverlap(uid, cin, cout, except) {
    const end = cout ?? Date.now();
    if (D.entries.some((e) => e.user_id === uid && e.id !== except && e.clock_in < end && (e.clock_out ?? Date.now()) > cin)) fail(400, 'This overlaps another shift for this person. Fix that shift first.');
    if (!cout && D.entries.some((e) => e.user_id === uid && e.id !== except && !e.clock_out)) fail(400, 'This person already has an open shift');
  }
  const paidWeek = (t, ms, s) => { const ws = weekStartOf(ymdOf(ms, s.timezone), s); return D.payments.some((p) => p.user_id === t.id && p.week_start === ws) ? ws : null; };
  const recordEdit = (eid, tid, ed, action, before, after, reason) => D.edits.push({ id: nextId(), entry_id: eid, user_id: tid, editor_id: ed, action, before_json: JSON.stringify(before), after_json: JSON.stringify(after), reason, at: Date.now() });
  route('POST', '/api/team/:id/entries', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, params, body }) => {
    const s = S(), t = getManaged(user, params.id), [cin, cout] = validateTimes(body, s), reason = str(body.reason);
    if (!reason) fail(400, 'Add a reason (for example: forgot to clock in)');
    checkOverlap(t.id, cin, cout, 0);
    const e = { id: nextId(), user_id: t.id, clock_in: cin, clock_out: cout, created_by: user.id, edited: 1, in_lat: null, in_lng: null };
    D.entries.push(e); recordEdit(e.id, t.id, user.id, 'add', null, { clock_in: cin, clock_out: cout }, reason);
    notify(t.id, 'Your hours were updated', `${user.name} added a shift: ${niceTime(cin, s.timezone)} – ${cout ? niceTime(cout, s.timezone) : 'still on the clock'}. Reason: ${reason}`);
    return { ok: true, paid_week: paidWeek(t, cin, s) };
  });
  const loadEntry = (user, id) => { const e = D.entries.find((x) => x.id === Number(id)); if (!e) fail(404, 'Shift not found'); return [e, getManaged(user, e.user_id)]; };
  route('PUT', '/api/entries/:id', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, params, body }) => {
    const s = S(), [e, t] = loadEntry(user, params.id), [cin, cout] = validateTimes(body, s), reason = str(body.reason);
    if (!reason) fail(400, 'Add a reason for the change');
    checkOverlap(t.id, cin, cout, e.id);
    const before = { clock_in: e.clock_in, clock_out: e.clock_out };
    Object.assign(e, { clock_in: cin, clock_out: cout, edited: 1 });
    recordEdit(e.id, t.id, user.id, 'edit', before, { clock_in: cin, clock_out: cout }, reason);
    notify(t.id, 'Your hours were updated', `${user.name} changed your shift to ${niceTime(cin, s.timezone)} – ${cout ? niceTime(cout, s.timezone) : 'still on the clock'}. Reason: ${reason}`);
    return { ok: true, paid_week: paidWeek(t, cin, s) || paidWeek(t, before.clock_in, s) };
  });
  route('DELETE', '/api/entries/:id', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, params, body }) => {
    const s = S(), [e, t] = loadEntry(user, params.id), reason = str(body.reason);
    if (!reason) fail(400, 'Add a reason for removing this shift');
    D.entries = D.entries.filter((x) => x.id !== e.id);
    recordEdit(e.id, t.id, user.id, 'delete', { clock_in: e.clock_in, clock_out: e.clock_out }, null, reason);
    notify(t.id, 'Your hours were updated', `${user.name} removed your shift from ${niceTime(e.clock_in, s.timezone)}. Reason: ${reason}`);
    return { ok: true, paid_week: paidWeek(t, e.clock_in, s) };
  });
  route('GET', '/api/team/requests', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, query }) => {
    const status = ['pending', 'approved', 'denied', 'cancelled'].includes(query.status) ? query.status : 'pending';
    const items = D.requests.filter((r) => { const u = userById(r.user_id); return r.status === status && u && (user.role === 'owner' ? u.role !== 'owner' : u.role === 'tech'); })
      .sort((a, b) => status === 'pending' ? a.start_date.localeCompare(b.start_date) : (b.decided_at - a.decided_at)).map(withLabel);
    return { items };
  });
  route('POST', '/api/team/requests/:id/decide', { auth: true, roles: ['owner', 'supervisor'] }, ({ user, params, body }) => {
    const r = D.requests.find((x) => x.id === Number(params.id)); if (!r) fail(404, 'Request not found');
    const t = getManaged(user, r.user_id);
    if (r.status !== 'pending') fail(400, 'This request was already handled');
    const status = body.status === 'approved' ? 'approved' : body.status === 'denied' ? 'denied' : fail(400, 'Approve or deny');
    const note = str(body.note);
    Object.assign(r, { status, decided_by: user.id, decided_at: Date.now(), decision_note: note });
    const range = r.start_date === r.end_date ? niceDate(r.start_date) : `${niceDate(r.start_date)} – ${niceDate(r.end_date)}`;
    const word = r.type === 'correction' ? (status === 'approved' ? 'fixed' : 'not changed') : status;
    notify(t.id, `${TYPE_LABEL[r.type]} ${word}`, `${user.name} ${status === 'approved' ? (r.type === 'correction' ? 'fixed your hours for' : 'approved your request for') : 'denied your request for'} ${range}.${note ? ' Note: ' + note : ''}`);
    return { ok: true };
  });

  route('GET', '/api/admin/people', { auth: true, roles: ['owner'] }, ({ user }) => {
    const people = D.users.filter((u) => u.role !== 'owner').sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name)).map((u) => publicUser(u, user));
    const invites = D.invites.filter((i) => i.kind === 'invite' && !i.used_at && !i.revoked && i.expires_at > Date.now()).sort((a, b) => b.created_at - a.created_at)
      .map((i) => ({ token_hint: i.token, name: i.name, role: i.role, hourly_rate: i.hourly_rate, lead_id: i.lead_id, created_at: i.created_at, expires_at: i.expires_at }));
    return { people, invites, leads: D.users.filter((u) => u.role !== 'tech' && u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })) };
  });
  route('POST', '/api/admin/invites', { auth: true, roles: ['owner'] }, ({ user, body }) => {
    const name = str(body.name, 80); if (!name) fail(400, 'Enter their name');
    const rate = num(body.hourly_rate); if (rate === null || rate < 0 || rate > 1000) fail(400, 'Enter an hourly rate');
    const i = { token: token(), kind: 'invite', name, role: body.role === 'supervisor' ? 'supervisor' : 'tech', hourly_rate: rate, lead_id: validLead(body.lead_id), created_by: user.id, created_at: Date.now(), expires_at: Date.now() + 14 * DAY };
    D.invites.push(i); D.lastInvite = i.token;
    const url = inviteUrl(i.token);
    return { url, qr_svg: window.VTQR.toSvg(url), expires_at: i.expires_at };
  });
  route('GET', '/api/admin/invites/:t/link', { auth: true, roles: ['owner'] }, ({ params }) => { const i = D.invites.find((x) => x.token === params.t); if (!i) fail(404, 'Invite not found'); const url = inviteUrl(i.token); return { url, qr_svg: window.VTQR.toSvg(url), name: i.name, expires_at: i.expires_at }; });
  route('DELETE', '/api/admin/invites/:t', { auth: true, roles: ['owner'] }, ({ params }) => { const i = D.invites.find((x) => x.token === params.t); if (i) i.revoked = 1; return { ok: true }; });
  route('PUT', '/api/admin/people/:id', { auth: true, roles: ['owner'] }, ({ params, body }) => {
    const t = userById(params.id); if (!t || t.role === 'owner') fail(404, 'Not found');
    const rate = num(body.hourly_rate); if (rate === null || rate < 0 || rate > 1000) fail(400, 'Enter an hourly rate');
    const lead = validLead(body.lead_id); if (lead === t.id) fail(400, 'A person cannot be their own lead');
    const phone = body.phone !== undefined ? normPhone(body.phone) : t.phone, email = body.email !== undefined ? normEmail(body.email) : t.email;
    if (!phone && !email) fail(400, 'Keep a phone or email so they can sign in');
    if (phone && D.users.some((u) => u.phone === phone && u.id !== t.id)) fail(400, 'Another account uses that phone');
    const wasLead = t.role === 'supervisor';
    Object.assign(t, { name: str(body.name, 80) || t.name, role: body.role === 'supervisor' ? 'supervisor' : 'tech', hourly_rate: rate, lead_id: lead, phone, email, active: body.active === false ? 0 : 1 });
    if (wasLead && t.role === 'tech') D.users.forEach((u) => { if (u.lead_id === t.id) u.lead_id = null; });
    if (!t.active && D.session === t.id) D.session = null;
    return { ok: true };
  });
  route('POST', '/api/admin/people/:id/reset', { auth: true, roles: ['owner'] }, ({ user, params }) => {
    const t = userById(params.id); if (!t || t.role === 'owner') fail(404, 'Not found');
    const i = { token: token(), kind: 'reset', user_id: t.id, created_by: user.id, created_at: Date.now(), expires_at: Date.now() + 2 * DAY };
    D.invites.push(i); const url = inviteUrl(i.token);
    return { url, qr_svg: window.VTQR.toSvg(url), name: t.name };
  });
  function payrollRows(ws, s) {
    const rows = [];
    for (const u of D.users.filter((x) => x.role !== 'owner').sort((a, b) => a.name.localeCompare(b.name))) {
      const w = weekSummary(u, ws, s);
      if (!u.active && w.hours === 0 && !w.payment) continue;
      if (w.hours === 0 && !w.payment) { rows.push({ user_id: u.id, name: u.name, idle: true }); continue; }
      rows.push({ user_id: u.id, name: u.name, role: u.role, rate: u.hourly_rate, hours: w.hours, regular: w.regular, overtime: w.overtime, gross: w.gross, open: w.open,
        payment: w.payment && { amount: w.payment.amount, hours: w.payment.hours, paid_at: w.payment.paid_at, paid_by_name: w.payment.paid_by_name, eta: w.payment.eta }, changed: !!(w.payment && Math.abs(w.payment.amount - w.gross) >= 0.01) });
    }
    return rows;
  }
  function defaultPayWeek(s) {
    const cur = currentWeekStart(s), today = ymdOf(Date.now(), s.timezone); let next = null;
    for (let i = 16; i >= 1; i--) {
      const ws = addDays(cur, -7 * i), pd = payDateOf(ws, s);
      if (payrollRows(ws, s).some((r) => !r.idle && !r.payment && r.gross > 0) && pd <= addDays(today, 7)) return ws;
      if (!next && pd >= today) next = ws;
    }
    return next || addDays(cur, -7);
  }
  route('GET', '/api/admin/payroll', { auth: true, roles: ['owner'] }, ({ query }) => {
    const s = S(), ws = parseYmd(query.week) ? weekStartOf(query.week, s) : defaultPayWeek(s);
    const rows = payrollRows(ws, s), a = rows.filter((r) => !r.idle);
    return { week_start: ws, week_end: addDays(ws, 6), pay_date: payDateOf(ws, s), normal_pay_date: payDateFor(ws, s), current_week: currentWeekStart(s), is_current: ws === currentWeekStart(s), rows,
      totals: { gross: round2(a.reduce((x, r) => x + r.gross, 0)), paid: round2(a.reduce((x, r) => x + (r.payment ? r.payment.amount : 0), 0)), unpaid: round2(a.filter((r) => !r.payment).reduce((x, r) => x + r.gross, 0)), hours: round2(a.reduce((x, r) => x + r.hours, 0)), people: a.length, paid_count: a.filter((r) => r.payment).length } };
  });
  route('POST', '/api/admin/payroll/mark', { auth: true, roles: ['owner'] }, ({ user, body }) => {
    const s = S(); if (!parseYmd(body.week_start)) fail(400, 'Bad week');
    const ws = weekStartOf(body.week_start, s), t = userById(body.user_id); if (!t || t.role === 'owner') fail(404, 'Person not found');
    const w = weekSummary(t, ws, s);
    if (w.gross <= 0) fail(400, 'Nothing to pay for this week');
    if (w.open) fail(400, `${t.name} is still clocked in for this week. Clock them out first.`);
    if (body.expected_amount !== undefined && Math.abs(Number(body.expected_amount) - w.gross) >= 0.01) fail(409, 'Hours changed while you were looking. Refresh and check again.');
    if (D.payments.some((p) => p.user_id === t.id && p.week_start === ws)) fail(409, `${t.name} is already marked paid for this week.`);
    const eta = checkEta(body.eta, s);
    D.payments.push({ id: nextId(), user_id: t.id, week_start: ws, hours: w.hours, ot_hours: w.overtime, rate: t.hourly_rate, amount: w.gross, paid_at: Date.now(), paid_by: user.id, eta });
    notify(t.id, 'Payment sent', `Your pay of ${money(w.gross)} for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} (${w.hours} hrs) has been sent. It should arrive ${etaWords(eta, s)}.`);
    return { ok: true };
  });
  function checkEta(v, s) {
    if (!parseYmd(v)) fail(400, 'Pick the date the money will arrive');
    const today = ymdOf(Date.now(), s.timezone);
    if (v < today) fail(400, 'The arrival date cannot be in the past');
    if (v > addDays(today, 30)) fail(400, 'Pick an arrival date within the next 30 days');
    return v;
  }
  function etaWords(eta, s) { const today = ymdOf(Date.now(), s.timezone); return eta === today ? 'today' : eta === addDays(today, 1) ? `tomorrow, ${niceDate(eta)}` : `on ${niceDate(eta)}`; }
  route('POST', '/api/admin/payroll/paydate', { auth: true, roles: ['owner'] }, ({ body }) => {
    const s = S(), ws = weekStartOf(body.week_start, s), before = payDateOf(ws, s);
    D.payOverrides = D.payOverrides || {};
    if (!body.pay_date || body.pay_date === payDateFor(ws, s)) delete D.payOverrides[ws];
    else { if (!parseYmd(body.pay_date)) fail(400, 'Pick a pay date'); if (body.pay_date <= addDays(ws, 6)) fail(400, 'The pay date has to be after the week ends'); D.payOverrides[ws] = body.pay_date; }
    const after = payDateOf(ws, s); let told = 0;
    if (after !== before) for (const r of payrollRows(ws, s)) { if (r.idle || r.payment || !(r.gross > 0)) continue; notify(r.user_id, 'Payday changed', `Pay for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} will now be sent ${niceDate(after)} (it was ${niceDate(before)}).`); told++; }
    return { ok: true, pay_date: after, notified: told };
  });
  route('POST', '/api/admin/payroll/eta', { auth: true, roles: ['owner'] }, ({ body }) => {
    const s = S(), ws = weekStartOf(body.week_start, s);
    const p = D.payments.find((x) => x.user_id === Number(body.user_id) && x.week_start === ws); if (!p) fail(404, 'This week is not marked paid yet');
    const eta = checkEta(body.eta, s); if (eta === p.eta) return { ok: true };
    p.eta = eta; notify(p.user_id, 'Pay arrival date changed', `Your pay of ${money(p.amount)} for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} should now arrive ${etaWords(eta, s)}.`);
    return { ok: true };
  });
  route('POST', '/api/admin/payroll/unmark', { auth: true, roles: ['owner'] }, ({ body }) => {
    const ws = weekStartOf(body.week_start, S()), before = D.payments.length;
    D.payments = D.payments.filter((p) => !(p.user_id === Number(body.user_id) && p.week_start === ws));
    if (D.payments.length === before) fail(404, 'No payment to undo'); return { ok: true };
  });
  route('GET', '/api/admin/settings', { auth: true, roles: ['owner'] }, () => ({ ...S() }));
  route('PUT', '/api/admin/settings', { auth: true, roles: ['owner'] }, ({ body }) => {
    const s = S(), n = { ...s };
    if (body.company_name !== undefined) n.company_name = str(body.company_name, 60) || s.company_name;
    if (body.timezone !== undefined) { try { new Intl.DateTimeFormat('en-US', { timeZone: String(body.timezone) }); n.timezone = String(body.timezone); } catch { fail(400, 'Unknown time zone'); } }
    const intIn = (v, lo, hi, l) => { const x = Number(v); if (!Number.isInteger(x) || x < lo || x > hi) fail(400, `${l} is not valid`); return x; };
    if (body.week_start_day !== undefined) n.week_start_day = intIn(body.week_start_day, 0, 6, 'Week start day');
    if (body.payday_weekday !== undefined) n.payday_weekday = intIn(body.payday_weekday, -1, 6, 'Payday');
    if (body.pay_delay_days !== undefined) n.pay_delay_days = intIn(body.pay_delay_days, 0, 90, 'Net days');
    if (body.max_shift_hours !== undefined) { const x = Number(body.max_shift_hours); if (!(x >= 0 && x <= 24)) fail(400, 'Max shift length must be 0–24 hours'); n.max_shift_hours = x; }
    if (body.timeoff_notice_days !== undefined) n.timeoff_notice_days = intIn(body.timeoff_notice_days, 0, 90, 'Notice days');
    if (body.ot_enabled !== undefined) n.ot_enabled = body.ot_enabled === true || body.ot_enabled === 'on' || body.ot_enabled === '1';
    if (body.ot_threshold !== undefined) { const x = Number(body.ot_threshold); if (!(x > 0 && x <= 168)) fail(400, 'Overtime hours is not valid'); n.ot_threshold = x; }
    if (body.ot_multiplier !== undefined) { const x = Number(body.ot_multiplier); if (!(x >= 1 && x <= 3)) fail(400, 'Overtime rate is not valid'); n.ot_multiplier = x; }
    D.settings = n; return { ...n };
  });
  route('POST', '/api/me/password', { auth: true }, ({ user, body }) => { if (user.password !== String(body.current || '')) fail(400, 'Current password is wrong (demo passwords are demo1234)'); if (String(body.next || '').length < 8) fail(400, 'New password must be at least 8 characters'); user.password = body.next; return { ok: true }; });

  function handle(method, url, bodyText) {
    const u = new URL(url, 'http://demo');
    const r = routes.find((x) => x.method === method && x.re.test(u.pathname));
    if (!r) return [404, { error: 'Not found' }];
    try {
      if (D.seq > 0) { capLongShifts(); }
      const m = r.re.exec(u.pathname), params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const user = D.session ? D.users.find((x) => x.id === D.session && x.active) : null;
      if (r.opts.auth) { if (!user) fail(401, 'Please sign in'); if (r.opts.roles && !r.opts.roles.includes(user.role)) fail(403, 'Not allowed'); }
      const body = bodyText ? JSON.parse(bodyText) : {};
      const out = r.fn({ user, params, body, query: Object.fromEntries(u.searchParams) });
      if (method !== 'GET') save();
      return [200, out];
    } catch (e) {
      if (e instanceof HttpError) return [e.status, { error: e.message }];
      console.error(e); return [500, { error: 'Something went wrong' }];
    }
  }

  /* ---------- wire up ---------- */
  D = load() || (seed(), D);
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, opts = {}) => {
    const s = typeof url === 'string' ? url : url.url;
    if (!s.startsWith('/api/')) return realFetch(url, opts);
    await new Promise((r) => setTimeout(r, 120));
    const [status, data] = handle((opts.method || 'GET').toUpperCase(), s, opts.body);
    return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  };
  window.VT_DEMO = {
    users: () => D.users.filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, role: u.role })),
    current: () => D.session,
    switchTo(id) { D.session = Number(id); save(); },
    reset() { try { localStorage.removeItem(KEY); } catch {} seed(); },
    lastInvite: () => D.lastInvite && D.invites.some((i) => i.token === D.lastInvite && !i.used_at && !i.revoked) ? D.lastInvite : null,
    csv(week) {
      const s = S(), ws = parseYmd(week) ? weekStartOf(week, s) : addDays(currentWeekStart(s), -7);
      const lines = ['Name,Role,Week start,Week end,Hours,Rate,Gross pay,Paid,Paid amount'];
      for (const r of payrollRows(ws, s).filter((x) => !x.idle)) lines.push([`"${r.name}"`, r.role, ws, addDays(ws, 6), r.hours, r.rate, r.gross, r.payment ? 'yes' : 'no', r.payment ? r.payment.amount : ''].join(','));
      return { name: `payroll-${ws}.csv`, text: lines.join('\n') + '\n' };
    }
  };
})();
