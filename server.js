'use strict';
/*
 * VayTech Time — clock in/out, pay, time off.
 * Zero dependencies: Node.js 22.5+ (built-in node:sqlite).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { toSvg: qrSvg } = require('./qr.js');

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const SESSION_DAYS = 60;
const INVITE_DAYS = 14;

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'vaytech.db'));
db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  phone TEXT UNIQUE,
  email TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner','supervisor','tech')),
  hourly_rate REAL NOT NULL DEFAULT 0,
  lead_id INTEGER REFERENCES users(id),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  name TEXT,
  role TEXT,
  hourly_rate REAL,
  lead_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  revoked INTEGER NOT NULL DEFAULT 0,
  token_hint TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS time_entries (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  clock_in INTEGER NOT NULL,
  clock_out INTEGER,
  in_lat REAL, in_lng REAL, in_acc REAL,
  out_lat REAL, out_lng REAL, out_acc REAL,
  created_by INTEGER NOT NULL,
  edited INTEGER NOT NULL DEFAULT 0,
  auto_capped INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_user ON time_entries(user_id, clock_in);
CREATE TABLE IF NOT EXISTS entry_edits (
  id INTEGER PRIMARY KEY,
  entry_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  editor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT,
  at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('time_off','sick','correction')),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied','cancelled')),
  decided_by INTEGER,
  decided_at INTEGER,
  decision_note TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  week_start TEXT NOT NULL,
  hours REAL NOT NULL,
  ot_hours REAL NOT NULL,
  rate REAL NOT NULL,
  amount REAL NOT NULL,
  paid_at INTEGER NOT NULL,
  paid_by INTEGER NOT NULL,
  UNIQUE (user_id, week_start)
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, created_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
try { db.exec('ALTER TABLE time_entries ADD COLUMN auto_capped INTEGER NOT NULL DEFAULT 0'); } catch { /* already there */ }
try { db.exec('ALTER TABLE payments ADD COLUMN eta TEXT'); } catch { /* already there */ }
db.exec('CREATE TABLE IF NOT EXISTS pay_date_overrides (week_start TEXT PRIMARY KEY, pay_date TEXT NOT NULL, set_by INTEGER, set_at INTEGER)');
// A payday the owner set by hand for one week wins over the normal schedule.
function payDateOf(weekStart, s) {
  const o = db.prepare('SELECT pay_date FROM pay_date_overrides WHERE week_start = ?').get(weekStart);
  return o ? o.pay_date : payDateFor(weekStart, s);
}

const DEFAULT_SETTINGS = {
  company_name: 'VayTech',
  timezone: 'America/Chicago',
  week_start_day: '1',      // 0=Sun … 6=Sat; 1 = Monday
  ot_enabled: '0',          // 0 = no overtime: every hour paid at the person's own rate
  ot_threshold: '40',       // hours per week before overtime (only if ot_enabled)
  ot_multiplier: '1.5',
  payday_weekday: '5',      // 0=Sun … 6=Sat, or -1 = no set weekday (pay exactly on the net date)
  pay_delay_days: '30',     // net terms: pay is due this many days after the week ends
  timeoff_notice_days: '14',
  max_shift_hours: '12'     // forgot to clock out? shifts are cut to this many hours (0 = no limit)
};
const hadNetDays = !!db.prepare(`SELECT 1 FROM settings WHERE key = 'pay_delay_days'`).get() && !!db.prepare(`SELECT 1 FROM settings WHERE key = 'payday_reset_v1'`).get();
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
  db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run(k, v);
}
// One-time: reset payday to "exactly on the net date" (a Saturday payday was set by mistake while choosing the work week).
if (!hadNetDays) {
  db.prepare(`UPDATE settings SET value = '-1' WHERE key = 'payday_weekday'`).run();
  db.prepare(`INSERT OR REPLACE INTO settings (key, value) VALUES ('payday_reset_v1', '1')`).run();
}
function getSettings() {
  const s = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all()) s[r.key] = r.value;
  return {
    company_name: s.company_name,
    timezone: s.timezone,
    week_start_day: Number(s.week_start_day),
    ot_enabled: s.ot_enabled === '1',
    ot_threshold: Number(s.ot_threshold),
    ot_multiplier: Number(s.ot_multiplier),
    payday_weekday: Number(s.payday_weekday),
    pay_delay_days: Number(s.pay_delay_days),
    timeoff_notice_days: Number(s.timeoff_notice_days),
    max_shift_hours: Number(s.max_shift_hours)
  };
}

/* ---------------- time zone helpers ---------------- */
const fmtCache = new Map();
function tzFormatter(tz) {
  if (!fmtCache.has(tz)) {
    fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }));
  }
  return fmtCache.get(tz);
}
function tzParts(ms, tz) {
  const p = {};
  for (const x of tzFormatter(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
function tzOffset(ms, tz) {
  const p = tzParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}
function zonedToUtc(y, m, d, h, mi, tz) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const off = tzOffset(guess, tz);
  let t = guess - off;
  const off2 = tzOffset(t, tz);
  if (off2 !== off) t = guess - off2;
  return t;
}
const pad = (n) => String(n).padStart(2, '0');
function ymdOf(ms, tz) { const p = tzParts(ms, tz); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; }
function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
function addDays(ymd, n) {
  const p = parseYmd(ymd);
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}
function dowOf(ymd) { const p = parseYmd(ymd); return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }
function midnightUtc(ymd, tz) { const p = parseYmd(ymd); return zonedToUtc(p.y, p.m, p.d, 0, 0, tz); }
function weekStartOf(ymd, s) { return addDays(ymd, -((dowOf(ymd) - s.week_start_day + 7) % 7)); }
function currentWeekStart(s) { return weekStartOf(ymdOf(Date.now(), s.timezone), s); }
// Pay date = week end + net days (at least 1), then moved forward to the payday weekday if one is set.
function payDateFor(weekStart, s) {
  const end = addDays(weekStart, 6);
  const target = addDays(end, Math.max(1, Number(s.pay_delay_days) || 0));
  if (!(s.payday_weekday >= 0 && s.payday_weekday <= 6)) return target;
  for (let i = 0; i < 7; i++) { const d = addDays(target, i); if (dowOf(d) === s.payday_weekday) return d; }
  return target;
}
function parseLocalDateTime(str, tz) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(str || ''));
  if (!m || !parseYmd(`${m[1]}-${m[2]}-${m[3]}`)) return null;
  const h = +m[4], mi = +m[5];
  if (h > 23 || mi > 59) return null;
  return zonedToUtc(+m[1], +m[2], +m[3], h, mi, tz);
}

/* ---------------- pay math ---------------- */
const round2 = (n) => Math.round(n * 100) / 100;
function weekSummary(user, weekStart, s, now = Date.now()) {
  const from = midnightUtc(weekStart, s.timezone);
  const to = midnightUtc(addDays(weekStart, 7), s.timezone);
  const entries = db.prepare(
    `SELECT * FROM time_entries WHERE user_id = ? AND clock_in < ? AND COALESCE(clock_out, ?) > ? ORDER BY clock_in`
  ).all(user.id, to, now, from);
  let ms = 0;
  const days = {};
  for (let i = 0; i < 7; i++) days[addDays(weekStart, i)] = 0;
  for (const e of entries) {
    const a = Math.max(e.clock_in, from);
    const b = Math.min(e.clock_out ?? now, to);
    if (b > a) {
      ms += b - a;
      const day = ymdOf(a, s.timezone);
      if (day in days) days[day] += (b - a) / 3600000;
    }
  }
  const hours = round2(ms / 3600000);
  const regular = s.ot_enabled ? round2(Math.min(hours, s.ot_threshold)) : hours;
  const overtime = s.ot_enabled ? round2(Math.max(0, hours - s.ot_threshold)) : 0;
  const rate = user.hourly_rate || 0;
  const gross = round2(regular * rate + overtime * rate * s.ot_multiplier);
  const payment = db.prepare(
    `SELECT p.*, u.name AS paid_by_name FROM payments p LEFT JOIN users u ON u.id = p.paid_by WHERE p.user_id = ? AND p.week_start = ?`
  ).get(user.id, weekStart) || null;
  return {
    week_start: weekStart, week_end: addDays(weekStart, 6), pay_date: payDateOf(weekStart, s), pay_date_custom: !!db.prepare('SELECT 1 FROM pay_date_overrides WHERE week_start = ?').get(weekStart), normal_pay_date: payDateFor(weekStart, s),
    hours, regular, overtime, rate, gross,
    days: Object.entries(days).map(([date, h]) => ({ date, hours: round2(h) })),
    open: entries.some((e) => !e.clock_out),
    entries, payment
  };
}

/* ---------------- auth helpers ---------------- */
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const key = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(keyHex, 'hex');
  return want.length === key.length && crypto.timingSafeEqual(key, want);
}
function normPhone(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d || null;
}
function normEmail(e) { const v = String(e || '').trim().toLowerCase(); return v || null; }
function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https' || PUBLIC_URL.startsWith('https://'); }
function createSession(res, req, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now, now + SESSION_DAYS * 86400000);
  res.setHeader('Set-Cookie', `vt_sess=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`);
}
function currentUser(req) {
  const token = parseCookies(req).vt_sess;
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ? AND u.active = 1`
  ).get(sha256(token), Date.now());
  return row || null;
}
const loginAttempts = new Map();
function rateLimited(key) {
  const now = Date.now();
  const rec = loginAttempts.get(key) || { n: 0, t: now };
  if (now - rec.t > 15 * 60000) { rec.n = 0; rec.t = now; }
  rec.n++;
  loginAttempts.set(key, rec);
  return rec.n > 10;
}
function publicUser(u, viewer) {
  if (!u) return null;
  const out = { id: u.id, name: u.name, role: u.role, phone: u.phone, email: u.email, lead_id: u.lead_id, active: !!u.active };
  if (viewer && (viewer.role === 'owner' || viewer.id === u.id)) out.hourly_rate = u.hourly_rate;
  return out;
}

/* ---------------- notifications ---------------- */
function notify(userId, title, body) {
  db.prepare('INSERT INTO notifications (user_id, title, body, created_at) VALUES (?, ?, ?, ?)').run(userId, title, body || '', Date.now());
}
function approversFor(user) {
  if (user.role === 'supervisor') return db.prepare(`SELECT id FROM users WHERE role = 'owner' AND active = 1`).all().map((r) => r.id);
  if (user.lead_id) {
    const lead = db.prepare('SELECT id FROM users WHERE id = ? AND active = 1').get(user.lead_id);
    if (lead) return [lead.id];
  }
  return db.prepare(`SELECT id FROM users WHERE role IN ('owner','supervisor') AND active = 1`).all().map((r) => r.id);
}
const money = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function niceDate(ymd) {
  const p = parseYmd(ymd);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' });
}
function niceTime(ms, tz) { return new Date(ms).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

/* ---------------- HTTP plumbing ---------------- */
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
function send(res, status, body, headers = {}) {
  const isStr = typeof body === 'string' || Buffer.isBuffer(body);
  res.writeHead(status, { 'Content-Type': isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(isStr ? body : JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 100000) { reject(new HttpError(413, 'Too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'Bad JSON')); }
    });
    req.on('error', reject);
  });
}
function baseUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  return `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}`;
}
const routes = [];
function route(method, pattern, opts, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, opts, handler });
}
function requireRole(user, roles) {
  if (!user) fail(401, 'Please sign in');
  if (roles && !roles.includes(user.role)) fail(403, 'Not allowed');
}
function canManage(viewer, target) {
  if (!target) return false;
  if (viewer.role === 'owner') return target.role !== 'owner';
  if (viewer.role === 'supervisor') return target.role === 'tech';
  return false;
}
function str(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

/* ---------------- routes: setup & auth ---------------- */
route('GET', '/api/bootstrap', {}, (req, res, { user }) => {
  const setupNeeded = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const s = getSettings();
  return { setupNeeded, user: publicUser(user, user), settings: { company_name: s.company_name, timezone: s.timezone, timeoff_notice_days: s.timeoff_notice_days } };
});

route('POST', '/api/setup', {}, (req, res, { body }) => {
  if (db.prepare('SELECT 1 FROM users LIMIT 1').get()) fail(400, 'Already set up');
  const name = str(body.name, 80), email = normEmail(body.email), phone = normPhone(body.phone);
  if (!name) fail(400, 'Enter your name');
  if (!email && !phone) fail(400, 'Enter an email or phone number');
  if (String(body.password || '').length < 8) fail(400, 'Password must be at least 8 characters');
  const r = db.prepare(`INSERT INTO users (name, email, phone, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'owner', ?)`)
    .run(name, email, phone, hashPassword(body.password), Date.now());
  createSession(res, req, Number(r.lastInsertRowid));
  return { ok: true };
});

route('POST', '/api/login', {}, (req, res, { body }) => {
  const login = str(body.login, 120);
  if (rateLimited((req.socket.remoteAddress || '') + '|' + login.toLowerCase())) fail(429, 'Too many tries. Wait 15 minutes.');
  const u = login.includes('@')
    ? db.prepare('SELECT * FROM users WHERE email = ?').get(normEmail(login))
    : db.prepare('SELECT * FROM users WHERE phone = ?').get(normPhone(login));
  if (!u || !verifyPassword(String(body.password || ''), u.password_hash)) fail(401, 'Wrong phone/email or password');
  if (!u.active) fail(403, 'This account is turned off. Talk to your supervisor.');
  createSession(res, req, u.id);
  return { ok: true };
});

route('POST', '/api/logout', {}, (req, res) => {
  const token = parseCookies(req).vt_sess;
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('Set-Cookie', 'vt_sess=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  return { ok: true };
});

function loadInvite(token) {
  const inv = db.prepare('SELECT * FROM invites WHERE token_hash = ?').get(sha256(String(token)));
  if (!inv || inv.revoked || inv.used_at) fail(404, 'This link has already been used or was cancelled. Ask for a new one.');
  if (inv.expires_at < Date.now()) fail(410, 'This link has expired. Ask for a new one.');
  return inv;
}
route('GET', '/api/invite/:token', {}, (req, res, { params }) => {
  const inv = loadInvite(params.token);
  const u = inv.user_id ? db.prepare('SELECT name, phone, email FROM users WHERE id = ?').get(inv.user_id) : null;
  return { kind: inv.kind, name: u ? u.name : inv.name, role: inv.role, company: getSettings().company_name };
});
route('POST', '/api/invite/:token/accept', {}, (req, res, { params, body }) => {
  const inv = loadInvite(params.token);
  const password = String(body.password || '');
  if (password.length < 8) fail(400, 'Password must be at least 8 characters');
  if (inv.kind === 'reset') {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), inv.user_id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(inv.user_id);
    db.prepare('UPDATE invites SET used_at = ? WHERE token_hash = ?').run(Date.now(), inv.token_hash);
    createSession(res, req, inv.user_id);
    return { ok: true };
  }
  const name = str(body.name, 80) || inv.name;
  const phone = normPhone(body.phone), email = normEmail(body.email);
  if (!phone) fail(400, 'Enter your phone number');
  if (phone.length < 10) fail(400, 'Enter a full phone number');
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'That email does not look right');
  if (db.prepare('SELECT 1 FROM users WHERE phone = ?').get(phone)) fail(400, 'That phone number already has an account. Sign in instead.');
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) fail(400, 'That email already has an account. Sign in instead.');
  const r = db.prepare(`INSERT INTO users (name, phone, email, password_hash, role, hourly_rate, lead_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(name, phone, email, hashPassword(password), inv.role, inv.hourly_rate || 0, inv.lead_id || null, Date.now());
  db.prepare('UPDATE invites SET used_at = ?, user_id = ?, token_hint = NULL WHERE token_hash = ?').run(Date.now(), Number(r.lastInsertRowid), inv.token_hash);
  notify(inv.created_by, `${name} joined`, `${name} created their account and can now clock in.`);
  createSession(res, req, Number(r.lastInsertRowid));
  return { ok: true };
});

/* ---------------- routes: my stuff ---------------- */
function openEntry(userId) { return db.prepare('SELECT * FROM time_entries WHERE user_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1').get(userId); }
function loc(body) {
  const lat = num(body.lat), lng = num(body.lng), acc = num(body.acc);
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return [null, null, null];
  return [lat, lng, acc];
}
route('GET', '/api/me/dashboard', { auth: true }, (req, res, { user }) => {
  const s = getSettings();
  const ws = currentWeekStart(s);
  const week = weekSummary(user, ws, s);
  const history = [];
  for (let i = 1; i <= 8; i++) {
    const w = weekSummary(user, addDays(ws, -7 * i), s);
    if (w.hours > 0 || w.payment) history.push({ week_start: w.week_start, week_end: w.week_end, pay_date: w.pay_date, hours: w.hours, overtime: w.overtime, gross: w.gross, payment: w.payment && { amount: w.payment.amount, paid_at: w.payment.paid_at, eta: w.payment.eta } });
  }
  return { open: openEntry(user.id) || null, week, history, settings: { ot_enabled: s.ot_enabled, ot_threshold: s.ot_threshold, ot_multiplier: s.ot_multiplier, max_shift_hours: s.max_shift_hours } };
});
route('GET', '/api/me/week', { auth: true }, (req, res, { user, query }) => {
  const s = getSettings();
  const start = parseYmd(query.start) ? weekStartOf(query.start, s) : currentWeekStart(s);
  return weekSummary(user, start, s);
});
route('POST', '/api/clock/in', { auth: true }, (req, res, { user, body }) => {
  if (user.role === 'owner') fail(400, 'Owner account does not clock in');
  if (openEntry(user.id)) fail(400, 'You are already clocked in');
  const [lat, lng, acc] = loc(body);
  db.prepare('INSERT INTO time_entries (user_id, clock_in, in_lat, in_lng, in_acc, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, Date.now(), lat, lng, acc, user.id);
  return { ok: true };
});
route('POST', '/api/clock/out', { auth: true }, (req, res, { user, body }) => {
  const e = openEntry(user.id);
  if (!e) {
    const last = db.prepare('SELECT * FROM time_entries WHERE user_id = ? ORDER BY clock_in DESC LIMIT 1').get(user.id);
    if (last && last.auto_capped && Date.now() - last.clock_out < 36 * 3600000) return { ok: true, capped: true, hours: getSettings().max_shift_hours };
    fail(400, 'You are not clocked in');
  }
  const [lat, lng, acc] = loc(body);
  db.prepare('UPDATE time_entries SET clock_out = ?, out_lat = ?, out_lng = ?, out_acc = ? WHERE id = ?').run(Math.max(Date.now(), e.clock_in), lat, lng, acc, e.id);
  return { ok: true };
});

/* Forgot to clock out: any shift longer than the limit is cut to exactly the limit. */
function capLongShifts(now = Date.now()) {
  const s = getSettings();
  if (!(s.max_shift_hours > 0)) return 0;
  const limit = s.max_shift_hours * 3600000;
  const open = db.prepare('SELECT e.*, u.name, u.lead_id, u.role FROM time_entries e JOIN users u ON u.id = e.user_id WHERE e.clock_out IS NULL AND e.clock_in <= ?').all(now - limit);
  for (const e of open) {
    const end = e.clock_in + limit;
    const r = db.prepare('UPDATE time_entries SET clock_out = ?, auto_capped = 1 WHERE id = ? AND clock_out IS NULL').run(end, e.id);
    if (!r.changes) continue;
    const hrs = s.max_shift_hours;
    recordEdit(e.id, e.user_id, e.user_id, 'auto', { clock_in: e.clock_in, clock_out: null }, { clock_in: e.clock_in, clock_out: end }, `Never clocked out. App ended the shift at ${hrs} hours.`);
    notify(e.user_id, 'Shift ended automatically', `You were on the clock ${hrs} hours (since ${niceTime(e.clock_in, s.timezone)}), so the app ended your shift at ${niceTime(end, s.timezone)}. If you left earlier, send a Fix my hours request.`);
    for (const id of approversFor(e)) notify(id, `${e.name}'s shift ended automatically`, `${e.name} clocked in ${niceTime(e.clock_in, s.timezone)} and never clocked out. The app counted ${hrs} hours. Check with them and fix it if needed.`);
  }
  return open.length;
}

route('GET', '/api/notifications', { auth: true }, (req, res, { user }) => {
  const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(user.id);
  const unread = db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n;
  return { items, unread };
});
route('GET', '/api/notifications/count', { auth: true }, (req, res, { user }) => {
  return { unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(user.id).n };
});
route('POST', '/api/notifications/read', { auth: true }, (req, res, { user }) => {
  db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(Date.now(), user.id);
  return { ok: true };
});

/* ---------------- routes: requests ---------------- */
const TYPE_LABEL = { time_off: 'Time off', sick: 'Sick leave', correction: 'Hours fix' };
function requestRow(r) { return r && { ...r, type_label: TYPE_LABEL[r.type] }; }
route('GET', '/api/requests', { auth: true }, (req, res, { user }) => {
  return { items: db.prepare(`SELECT r.*, d.name AS decided_by_name FROM requests r LEFT JOIN users d ON d.id = r.decided_by WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 100`).all(user.id).map(requestRow) };
});
route('POST', '/api/requests', { auth: true }, (req, res, { user, body }) => {
  if (user.role === 'owner') fail(400, 'Owner account does not send requests');
  const s = getSettings();
  const type = String(body.type);
  if (!TYPE_LABEL[type]) fail(400, 'Pick a request type');
  const start = String(body.start_date || ''), end = String(body.end_date || body.start_date || '');
  if (!parseYmd(start) || !parseYmd(end)) fail(400, 'Pick the date(s)');
  if (end < start) fail(400, 'End date is before start date');
  if (addDays(start, 60) < end) fail(400, 'Requests can cover up to 60 days');
  const today = ymdOf(Date.now(), s.timezone);
  const reason = str(body.reason, 1000);
  if (type === 'time_off') {
    const earliest = addDays(today, s.timeoff_notice_days);
    if (start < earliest) fail(400, `Time off must be requested at least ${s.timeoff_notice_days} days ahead. Earliest date: ${niceDate(earliest)}.`);
  }
  if (type === 'sick' && start > addDays(today, 30)) fail(400, 'Sick leave can only be for now or the near future');
  if (type === 'correction') {
    if (start > today) fail(400, 'Pick the day that needs fixing');
    if (!reason) fail(400, 'Tell your lead what needs fixing, e.g. "Forgot to clock out, left at 4:30 PM"');
  }
  const r = db.prepare('INSERT INTO requests (user_id, type, start_date, end_date, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, type, start, end, reason, Date.now());
  const range = start === end ? niceDate(start) : `${niceDate(start)} – ${niceDate(end)}`;
  for (const id of approversFor(user)) notify(id, `New ${TYPE_LABEL[type].toLowerCase()} request`, `${user.name}: ${range}${reason ? ' — ' + reason : ''}`);
  return { ok: true, id: Number(r.lastInsertRowid) };
});
route('POST', '/api/requests/:id/cancel', { auth: true }, (req, res, { user, params }) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ? AND user_id = ?').get(Number(params.id), user.id);
  if (!r) fail(404, 'Not found');
  if (r.status !== 'pending') fail(400, 'Only pending requests can be cancelled');
  db.prepare(`UPDATE requests SET status = 'cancelled' WHERE id = ?`).run(r.id);
  return { ok: true };
});

/* ---------------- routes: team (supervisor + owner) ---------------- */
function teamQuery(viewer) {
  const roles = viewer.role === 'owner' ? `('supervisor','tech')` : `('tech')`;
  return db.prepare(`SELECT * FROM users WHERE role IN ${roles} ORDER BY active DESC, name COLLATE NOCASE`).all();
}
route('GET', '/api/team', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user }) => {
  const s = getSettings();
  const ws = currentWeekStart(s);
  const leads = db.prepare(`SELECT id, name FROM users WHERE role IN ('owner','supervisor') AND active = 1 ORDER BY name`).all();
  const people = teamQuery(user).map((u) => {
    const w = weekSummary(u, ws, s);
    const open = openEntry(u.id);
    const out = { ...publicUser(u, user), week_hours: w.hours, week_overtime: w.overtime, open: open || null };
    if (user.role === 'owner') out.week_gross = w.gross;
    return out;
  });
  return { people, leads, me: user.id };
});
function getManaged(viewer, id) {
  const t = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(id));
  if (!canManage(viewer, t)) fail(403, 'Not allowed');
  return t;
}
route('GET', '/api/team/:id/week', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, params, query }) => {
  const s = getSettings();
  const t = getManaged(user, params.id);
  const start = parseYmd(query.start) ? weekStartOf(query.start, s) : currentWeekStart(s);
  const w = weekSummary(t, start, s);
  const ids = w.entries.map((e) => e.id);
  const edits = ids.length ? db.prepare(`SELECT e.*, u.name AS editor_name FROM entry_edits e LEFT JOIN users u ON u.id = e.editor_id WHERE e.user_id = ? AND e.at > ? ORDER BY e.at DESC LIMIT 50`).all(t.id, midnightUtc(start, s.timezone) - 86400000 * 7) : [];
  if (user.role !== 'owner') { delete w.rate; delete w.gross; delete w.payment; }
  return { person: publicUser(t, user), week: w, edits };
});
function recordEdit(entryId, targetId, editorId, action, before, after, reason) {
  db.prepare('INSERT INTO entry_edits (entry_id, user_id, editor_id, action, before_json, after_json, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(entryId, targetId, editorId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, reason, Date.now());
}
function validateTimes(body, s) {
  const cin = parseLocalDateTime(body.clock_in, s.timezone);
  if (!cin) fail(400, 'Enter a clock-in time');
  let cout = null;
  if (body.clock_out) {
    cout = parseLocalDateTime(body.clock_out, s.timezone);
    if (!cout) fail(400, 'Clock-out time is not valid');
    if (cout <= cin) fail(400, 'Clock-out must be after clock-in');
    if (cout - cin > 24 * 3600000) fail(400, 'A single shift cannot be longer than 24 hours');
  }
  if (cin > Date.now() + 5 * 60000) fail(400, 'Clock-in cannot be in the future');
  if (cout && cout > Date.now() + 5 * 60000) fail(400, 'Clock-out cannot be in the future');
  return [cin, cout];
}
function checkOverlap(userId, cin, cout, exceptId) {
  const end = cout ?? Date.now();
  const clash = db.prepare(`SELECT id FROM time_entries WHERE user_id = ? AND id != ? AND clock_in < ? AND COALESCE(clock_out, ?) > ?`).get(userId, exceptId || 0, end, Date.now(), cin);
  if (clash) fail(400, 'This overlaps another shift for this person. Fix that shift first.');
  if (!cout && db.prepare('SELECT 1 FROM time_entries WHERE user_id = ? AND id != ? AND clock_out IS NULL').get(userId, exceptId || 0)) fail(400, 'This person already has an open shift');
}
function paidWarning(target, ms, s) {
  const ws = weekStartOf(ymdOf(ms, s.timezone), s);
  const p = db.prepare('SELECT 1 FROM payments WHERE user_id = ? AND week_start = ?').get(target.id, ws);
  return p ? ws : null;
}
function adjustNotice(target, editor, text, s) {
  notify(target.id, 'Your hours were updated', `${editor.name} ${text}`);
}
route('POST', '/api/team/:id/entries', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, params, body }) => {
  const s = getSettings();
  const t = getManaged(user, params.id);
  const [cin, cout] = validateTimes(body, s);
  const reason = str(body.reason, 500);
  if (!reason) fail(400, 'Add a reason (for example: forgot to clock in)');
  checkOverlap(t.id, cin, cout, 0);
  const r = db.prepare('INSERT INTO time_entries (user_id, clock_in, clock_out, created_by, edited) VALUES (?, ?, ?, ?, 1)').run(t.id, cin, cout, user.id);
  recordEdit(Number(r.lastInsertRowid), t.id, user.id, 'add', null, { clock_in: cin, clock_out: cout }, reason);
  adjustNotice(t, user, `added a shift: ${niceTime(cin, s.timezone)} – ${cout ? niceTime(cout, s.timezone) : 'still on the clock'}. Reason: ${reason}`, s);
  return { ok: true, paid_week: paidWarning(t, cin, s) };
});
function loadEntryFor(user, id) {
  const e = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(Number(id));
  if (!e) fail(404, 'Shift not found');
  const t = getManaged(user, e.user_id);
  return [e, t];
}
route('PUT', '/api/entries/:id', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, params, body }) => {
  const s = getSettings();
  const [e, t] = loadEntryFor(user, params.id);
  const [cin, cout] = validateTimes(body, s);
  const reason = str(body.reason, 500);
  if (!reason) fail(400, 'Add a reason for the change');
  checkOverlap(t.id, cin, cout, e.id);
  db.prepare('UPDATE time_entries SET clock_in = ?, clock_out = ?, edited = 1 WHERE id = ?').run(cin, cout, e.id);
  recordEdit(e.id, t.id, user.id, 'edit', { clock_in: e.clock_in, clock_out: e.clock_out }, { clock_in: cin, clock_out: cout }, reason);
  adjustNotice(t, user, `changed your shift to ${niceTime(cin, s.timezone)} – ${cout ? niceTime(cout, s.timezone) : 'still on the clock'}. Reason: ${reason}`, s);
  return { ok: true, paid_week: paidWarning(t, cin, s) || paidWarning(t, e.clock_in, s) };
});
route('DELETE', '/api/entries/:id', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, params, body }) => {
  const s = getSettings();
  const [e, t] = loadEntryFor(user, params.id);
  const reason = str(body.reason, 500);
  if (!reason) fail(400, 'Add a reason for removing this shift');
  db.prepare('DELETE FROM time_entries WHERE id = ?').run(e.id);
  recordEdit(e.id, t.id, user.id, 'delete', { clock_in: e.clock_in, clock_out: e.clock_out }, null, reason);
  adjustNotice(t, user, `removed your shift from ${niceTime(e.clock_in, s.timezone)}. Reason: ${reason}`, s);
  return { ok: true, paid_week: paidWarning(t, e.clock_in, s) };
});

route('GET', '/api/team/requests', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, query }) => {
  const roles = user.role === 'owner' ? `('supervisor','tech')` : `('tech')`;
  const status = ['pending', 'approved', 'denied', 'cancelled'].includes(query.status) ? query.status : 'pending';
  const items = db.prepare(`SELECT r.*, u.name AS user_name, u.lead_id, d.name AS decided_by_name FROM requests r JOIN users u ON u.id = r.user_id LEFT JOIN users d ON d.id = r.decided_by
    WHERE u.role IN ${roles} AND r.status = ? ORDER BY ${status === 'pending' ? 'r.start_date ASC' : 'r.decided_at DESC'} LIMIT 200`).all(status).map(requestRow);
  return { items };
});
route('POST', '/api/team/requests/:id/decide', { auth: true, roles: ['owner', 'supervisor'] }, (req, res, { user, params, body }) => {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(params.id));
  if (!r) fail(404, 'Request not found');
  const t = getManaged(user, r.user_id);
  if (r.status !== 'pending') fail(400, 'This request was already handled');
  const status = body.status === 'approved' ? 'approved' : body.status === 'denied' ? 'denied' : null;
  if (!status) fail(400, 'Approve or deny');
  const note = str(body.note, 500);
  db.prepare('UPDATE requests SET status = ?, decided_by = ?, decided_at = ?, decision_note = ? WHERE id = ? AND status = ?').run(status, user.id, Date.now(), note, r.id, 'pending');
  const range = r.start_date === r.end_date ? niceDate(r.start_date) : `${niceDate(r.start_date)} – ${niceDate(r.end_date)}`;
  const word = r.type === 'correction' ? (status === 'approved' ? 'fixed' : 'not changed') : status;
  notify(t.id, `${TYPE_LABEL[r.type]} ${word}`, `${user.name} ${status === 'approved' ? (r.type === 'correction' ? 'fixed your hours for' : 'approved your request for') : 'denied your request for'} ${range}.${note ? ' Note: ' + note : ''}`);
  return { ok: true };
});

/* ---------------- routes: owner admin ---------------- */
route('GET', '/api/admin/people', { auth: true, roles: ['owner'] }, (req, res, { user }) => {
  const people = db.prepare(`SELECT * FROM users WHERE role != 'owner' ORDER BY active DESC, name COLLATE NOCASE`).all().map((u) => publicUser(u, user));
  const invites = db.prepare(`SELECT i.token_hint, i.name, i.role, i.hourly_rate, i.lead_id, i.created_at, i.expires_at, l.name AS lead_name FROM invites i LEFT JOIN users l ON l.id = i.lead_id
    WHERE i.kind = 'invite' AND i.used_at IS NULL AND i.revoked = 0 AND i.expires_at > ? ORDER BY i.created_at DESC`).all(Date.now());
  const leads = db.prepare(`SELECT id, name, role FROM users WHERE role IN ('owner','supervisor') AND active = 1 ORDER BY name`).all();
  return { people, invites, leads };
});
function newToken() { return crypto.randomBytes(18).toString('base64url'); }
function validLead(id) {
  if (!id) return null;
  const l = db.prepare(`SELECT id FROM users WHERE id = ? AND role IN ('owner','supervisor')`).get(Number(id));
  if (!l) fail(400, 'Pick a valid team lead');
  return l.id;
}
route('POST', '/api/admin/invites', { auth: true, roles: ['owner'] }, (req, res, { user, body }) => {
  const name = str(body.name, 80);
  if (!name) fail(400, 'Enter their name');
  const role = body.role === 'supervisor' ? 'supervisor' : 'tech';
  const rate = num(body.hourly_rate);
  if (rate === null || rate < 0 || rate > 1000) fail(400, 'Enter an hourly rate');
  const lead = validLead(body.lead_id);
  const token = newToken();
  const now = Date.now();
  db.prepare(`INSERT INTO invites (token_hash, kind, name, role, hourly_rate, lead_id, created_by, created_at, expires_at, token_hint) VALUES (?, 'invite', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sha256(token), name, role, rate, lead, user.id, now, now + INVITE_DAYS * 86400000, token);
  const url = `${baseUrl(req)}/join/${token}`;
  return { url, qr_svg: qrSvg(url), expires_at: now + INVITE_DAYS * 86400000 };
});
route('GET', '/api/admin/invites/:hint/link', { auth: true, roles: ['owner'] }, (req, res, { params }) => {
  const inv = db.prepare(`SELECT * FROM invites WHERE token_hint = ? AND kind = 'invite' AND used_at IS NULL AND revoked = 0`).get(params.hint);
  if (!inv) fail(404, 'Invite not found');
  const url = `${baseUrl(req)}/join/${inv.token_hint}`;
  return { url, qr_svg: qrSvg(url), name: inv.name, expires_at: inv.expires_at };
});
route('DELETE', '/api/admin/invites/:hint', { auth: true, roles: ['owner'] }, (req, res, { params }) => {
  db.prepare(`UPDATE invites SET revoked = 1, token_hint = NULL WHERE token_hint = ?`).run(params.hint);
  return { ok: true };
});
route('PUT', '/api/admin/people/:id', { auth: true, roles: ['owner'] }, (req, res, { user, params, body }) => {
  const t = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'owner'`).get(Number(params.id));
  if (!t) fail(404, 'Not found');
  const name = str(body.name, 80) || t.name;
  const role = body.role === 'supervisor' ? 'supervisor' : 'tech';
  const rate = num(body.hourly_rate);
  if (rate === null || rate < 0 || rate > 1000) fail(400, 'Enter an hourly rate');
  const lead = validLead(body.lead_id);
  if (lead === t.id) fail(400, 'A person cannot be their own lead');
  const phone = body.phone !== undefined ? normPhone(body.phone) : t.phone;
  const email = body.email !== undefined ? normEmail(body.email) : t.email;
  if (!phone && !email) fail(400, 'Keep a phone or email so they can sign in');
  if (phone && db.prepare('SELECT 1 FROM users WHERE phone = ? AND id != ?').get(phone, t.id)) fail(400, 'Another account uses that phone');
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, t.id)) fail(400, 'Another account uses that email');
  const active = body.active === false ? 0 : 1;
  db.prepare('UPDATE users SET name = ?, role = ?, hourly_rate = ?, lead_id = ?, phone = ?, email = ?, active = ? WHERE id = ?').run(name, role, rate, lead, phone, email, active, t.id);
  if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
  if (role === 'tech' && t.role === 'supervisor') db.prepare('UPDATE users SET lead_id = NULL WHERE lead_id = ?').run(t.id);
  return { ok: true };
});
route('POST', '/api/admin/people/:id/reset', { auth: true, roles: ['owner'] }, (req, res, { user, params }) => {
  const t = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'owner'`).get(Number(params.id));
  if (!t) fail(404, 'Not found');
  const token = newToken();
  const now = Date.now();
  db.prepare(`UPDATE invites SET revoked = 1 WHERE kind = 'reset' AND user_id = ? AND used_at IS NULL`).run(t.id);
  db.prepare(`INSERT INTO invites (token_hash, kind, user_id, created_by, created_at, expires_at) VALUES (?, 'reset', ?, ?, ?, ?)`).run(sha256(token), t.id, user.id, now, now + 2 * 86400000);
  const url = `${baseUrl(req)}/join/${token}`;
  return { url, qr_svg: qrSvg(url), name: t.name };
});

function payrollRows(weekStart, s) {
  const users = db.prepare(`SELECT * FROM users WHERE role IN ('supervisor','tech') ORDER BY name COLLATE NOCASE`).all();
  const rows = [];
  for (const u of users) {
    const w = weekSummary(u, weekStart, s);
    if (!u.active && w.hours === 0 && !w.payment) continue;
    if (w.hours === 0 && !w.payment) { rows.push({ user_id: u.id, name: u.name, role: u.role, rate: u.hourly_rate, hours: 0, regular: 0, overtime: 0, gross: 0, open: false, payment: null, idle: true }); continue; }
    rows.push({
      user_id: u.id, name: u.name, role: u.role, rate: u.hourly_rate, hours: w.hours, regular: w.regular, overtime: w.overtime, gross: w.gross, open: w.open,
      payment: w.payment && { amount: w.payment.amount, hours: w.payment.hours, paid_at: w.payment.paid_at, paid_by_name: w.payment.paid_by_name, eta: w.payment.eta },
      changed: !!(w.payment && Math.abs(w.payment.amount - w.gross) >= 0.01)
    });
  }
  return rows;
}
// Which week to show first: the oldest week that is due (or due within a week) and not fully paid;
// otherwise the week with the next upcoming pay date.
function defaultPayWeek(s) {
  const cur = currentWeekStart(s), today = ymdOf(Date.now(), s.timezone);
  let next = null;
  for (let i = 16; i >= 1; i--) {
    const ws = addDays(cur, -7 * i), pd = payDateOf(ws, s);
    const unpaid = payrollRows(ws, s).some((r) => !r.idle && !r.payment && r.gross > 0);
    if (unpaid && pd <= addDays(today, 7)) return ws;
    if (!next && pd >= today) next = ws;
  }
  return next || addDays(cur, -7);
}
route('GET', '/api/admin/payroll', { auth: true, roles: ['owner'] }, (req, res, { query }) => {
  const s = getSettings();
  const ws = parseYmd(query.week) ? weekStartOf(query.week, s) : defaultPayWeek(s);
  const rows = payrollRows(ws, s);
  const active = rows.filter((r) => !r.idle);
  return {
    week_start: ws, week_end: addDays(ws, 6), pay_date: payDateOf(ws, s), normal_pay_date: payDateFor(ws, s), current_week: currentWeekStart(s),
    is_current: ws === currentWeekStart(s), rows,
    totals: {
      gross: round2(active.reduce((a, r) => a + r.gross, 0)),
      paid: round2(active.reduce((a, r) => a + (r.payment ? r.payment.amount : 0), 0)),
      unpaid: round2(active.filter((r) => !r.payment).reduce((a, r) => a + r.gross, 0)),
      hours: round2(active.reduce((a, r) => a + r.hours, 0)),
      people: active.length, paid_count: active.filter((r) => r.payment).length
    }
  };
});
route('POST', '/api/admin/payroll/mark', { auth: true, roles: ['owner'] }, (req, res, { user, body }) => {
  const s = getSettings();
  const ws = parseYmd(body.week_start) ? weekStartOf(body.week_start, s) : fail(400, 'Bad week');
  const t = db.prepare(`SELECT * FROM users WHERE id = ? AND role != 'owner'`).get(Number(body.user_id));
  if (!t) fail(404, 'Person not found');
  const w = weekSummary(t, ws, s);
  if (w.gross <= 0) fail(400, 'Nothing to pay for this week');
  if (w.open) fail(400, `${t.name} is still clocked in for this week. Clock them out first.`);
  if (body.expected_amount !== undefined && Math.abs(Number(body.expected_amount) - w.gross) >= 0.01) fail(409, 'Hours changed while you were looking. Refresh and check again.');
  const eta = checkEta(body.eta, s);
  try {
    db.prepare('INSERT INTO payments (user_id, week_start, hours, ot_hours, rate, amount, paid_at, paid_by, eta) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(t.id, ws, w.hours, w.overtime, t.hourly_rate, w.gross, Date.now(), user.id, eta);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) fail(409, `${t.name} is already marked paid for this week.`);
    throw err;
  }
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
function etaWords(eta, s) {
  const today = ymdOf(Date.now(), s.timezone);
  if (eta === today) return 'today';
  if (eta === addDays(today, 1)) return `tomorrow, ${niceDate(eta)}`;
  return `on ${niceDate(eta)}`;
}
route('POST', '/api/admin/payroll/paydate', { auth: true, roles: ['owner'] }, (req, res, { user, body }) => {
  const s = getSettings();
  const ws = parseYmd(body.week_start) ? weekStartOf(body.week_start, s) : fail(400, 'Bad week');
  const before = payDateOf(ws, s);
  if (body.pay_date === null || body.pay_date === '' || body.pay_date === payDateFor(ws, s)) {
    db.prepare('DELETE FROM pay_date_overrides WHERE week_start = ?').run(ws);
  } else {
    if (!parseYmd(body.pay_date)) fail(400, 'Pick a pay date');
    if (body.pay_date <= addDays(ws, 6)) fail(400, 'The pay date has to be after the week ends');
    if (body.pay_date > addDays(ws, 120)) fail(400, 'Pick a pay date within about 4 months of the week');
    db.prepare('INSERT INTO pay_date_overrides (week_start, pay_date, set_by, set_at) VALUES (?, ?, ?, ?) ON CONFLICT(week_start) DO UPDATE SET pay_date = excluded.pay_date, set_by = excluded.set_by, set_at = excluded.set_at').run(ws, body.pay_date, user.id, Date.now());
  }
  const after = payDateOf(ws, s);
  let told = 0;
  if (after !== before) {
    for (const r of payrollRows(ws, s)) {
      if (r.idle || r.payment || !(r.gross > 0)) continue;
      notify(r.user_id, 'Payday changed', `Pay for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} will now be sent ${niceDate(after)} (it was ${niceDate(before)}).`);
      told++;
    }
  }
  return { ok: true, pay_date: after, notified: told };
});
route('POST', '/api/admin/payroll/eta', { auth: true, roles: ['owner'] }, (req, res, { body }) => {
  const s = getSettings();
  const ws = parseYmd(body.week_start) ? weekStartOf(body.week_start, s) : fail(400, 'Bad week');
  const p = db.prepare('SELECT * FROM payments WHERE user_id = ? AND week_start = ?').get(Number(body.user_id), ws);
  if (!p) fail(404, 'This week is not marked paid yet');
  const eta = checkEta(body.eta, s);
  if (eta === p.eta) return { ok: true };
  db.prepare('UPDATE payments SET eta = ? WHERE id = ?').run(eta, p.id);
  notify(p.user_id, 'Pay arrival date changed', `Your pay of ${money(p.amount)} for ${niceDate(ws)} – ${niceDate(addDays(ws, 6))} should now arrive ${etaWords(eta, s)}.`);
  return { ok: true };
});
route('POST', '/api/admin/payroll/unmark', { auth: true, roles: ['owner'] }, (req, res, { body }) => {
  const s = getSettings();
  const ws = parseYmd(body.week_start) ? weekStartOf(body.week_start, s) : fail(400, 'Bad week');
  const r = db.prepare('DELETE FROM payments WHERE user_id = ? AND week_start = ?').run(Number(body.user_id), ws);
  if (!r.changes) fail(404, 'No payment to undo');
  return { ok: true };
});
route('GET', '/api/admin/payroll.csv', { auth: true, roles: ['owner'] }, (req, res, { query }) => {
  const s = getSettings();
  const ws = parseYmd(query.week) ? weekStartOf(query.week, s) : addDays(currentWeekStart(s), -7);
  const esc = (v) => /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v);
  const lines = [['Name', 'Role', 'Week start', 'Week end', 'Total hours', 'Regular hours', 'Overtime hours', 'Rate', 'Gross pay', 'Paid', 'Paid amount', 'Paid on', 'Arrives'].join(',')];
  for (const r of payrollRows(ws, s).filter((x) => !x.idle)) {
    lines.push([r.name, r.role, ws, addDays(ws, 6), r.hours, r.regular, r.overtime, r.rate, r.gross, r.payment ? 'yes' : 'no', r.payment ? r.payment.amount : '', r.payment ? ymdOf(r.payment.paid_at, s.timezone) : '', r.payment && r.payment.eta ? r.payment.eta : ''].map(esc).join(','));
  }
  send(res, 200, lines.join('\n') + '\n', { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="payroll-${ws}.csv"` });
  return undefined;
});
route('GET', '/api/admin/backup', { auth: true, roles: ['owner'] }, (req, res) => {
  const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const data = fs.readFileSync(file);
  fs.unlinkSync(file);
  send(res, 200, data, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="vaytech-backup-${ymdOf(Date.now(), getSettings().timezone)}.db"` });
  return undefined;
});
route('GET', '/api/health', {}, () => ({ ok: true }));
route('GET', '/api/admin/settings',{ auth: true, roles: ['owner'] }, () => getSettings());
route('PUT', '/api/admin/settings', { auth: true, roles: ['owner'] }, (req, res, { body }) => {
  const s = getSettings();
  const next = { ...s };
  if (body.company_name !== undefined) next.company_name = str(body.company_name, 60) || s.company_name;
  if (body.timezone !== undefined) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: String(body.timezone) }); next.timezone = String(body.timezone); } catch { fail(400, 'Unknown time zone'); }
  }
  const intIn = (v, lo, hi, label) => { const n = Number(v); if (!Number.isInteger(n) || n < lo || n > hi) fail(400, `${label} is not valid`); return n; };
  if (body.week_start_day !== undefined) next.week_start_day = intIn(body.week_start_day, 0, 6, 'Week start day');
  if (body.payday_weekday !== undefined) next.payday_weekday = intIn(body.payday_weekday, -1, 6, 'Payday');
  if (body.pay_delay_days !== undefined) next.pay_delay_days = intIn(body.pay_delay_days, 0, 90, 'Net days');
  if (body.max_shift_hours !== undefined) { const n = Number(body.max_shift_hours); if (!(n >= 0 && n <= 24)) fail(400, 'Max shift length must be 0–24 hours'); next.max_shift_hours = n; }
  if (body.timeoff_notice_days !== undefined) next.timeoff_notice_days = intIn(body.timeoff_notice_days, 0, 90, 'Notice days');
  if (body.ot_enabled !== undefined) next.ot_enabled = body.ot_enabled === true || body.ot_enabled === '1' || body.ot_enabled === 'on';
  if (body.ot_threshold !== undefined) { const n = Number(body.ot_threshold); if (!(n > 0 && n <= 168)) fail(400, 'Overtime hours is not valid'); next.ot_threshold = n; }
  if (body.ot_multiplier !== undefined) { const n = Number(body.ot_multiplier); if (!(n >= 1 && n <= 3)) fail(400, 'Overtime rate is not valid'); next.ot_multiplier = n; }
  const up = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
  for (const k of Object.keys(DEFAULT_SETTINGS)) up.run(k === 'ot_enabled' ? (next.ot_enabled ? '1' : '0') : String(next[k]), k);
  return getSettings();
});
route('POST', '/api/me/password', { auth: true }, (req, res, { user, body }) => {
  if (!verifyPassword(String(body.current || ''), user.password_hash)) fail(400, 'Current password is wrong');
  if (String(body.next || '').length < 8) fail(400, 'New password must be at least 8 characters');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.next), user.id);
  return { ok: true };
});

/* ---------------- static files ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    const ext = path.extname(file);
    const cache = ext === '.html' || rel === '/sw.js' ? 'no-cache' : 'public, max-age=3600';
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
    res.end(data);
  });
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self';style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"
};

const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  const url = new URL(req.url, 'http://x');
  try {
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      return serveStatic(req, res, url.pathname);
    }
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(res, 404, { error: 'Not found' });
    if (req.method !== 'GET' && req.headers['x-vt'] !== '1') return send(res, 403, { error: 'Bad request origin' });
    const m = r.re.exec(url.pathname);
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    capLongShifts();
    const user = currentUser(req);
    if (r.opts.auth) requireRole(user, r.opts.roles);
    const body = req.method === 'GET' ? {} : await readBody(req);
    const query = Object.fromEntries(url.searchParams);
    const out = r.handler(req, res, { user, params, body, query });
    if (out !== undefined && !res.headersSent) send(res, 200, out);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: 'Something went wrong. Try again.' });
  }
});

// housekeeping: drop expired sessions daily
setInterval(() => { try { capLongShifts(); } catch (e) { console.error(e); } }, 60000).unref();
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 86400000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`VayTech Time running on http://localhost:${PORT}`));
}
module.exports = { server, db, capLongShifts, _t: { zonedToUtc, weekStartOf, payDateFor, ymdOf, addDays } };
