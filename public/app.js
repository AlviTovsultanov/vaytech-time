'use strict';
/* VayTech Time — front end (no build step) */
(() => {
  const $app = document.getElementById('app');
  const $sheet = document.getElementById('sheet-root');
  const S = { boot: null, user: null, tz: 'America/Chicago', tab: null, unread: 0, timer: null, poll: null, crewOnly: true, apprStatus: 'pending', payWeek: null };

  /* ---------- utilities ---------- */
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  async function api(method, url, body) {
    const opts = { method, headers: { 'X-VT': '1' }, credentials: 'same-origin' };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    let res;
    try { res = await fetch(url, opts); } catch { throw new Error('No connection. Check your signal and try again.'); }
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && S.user) { S.user = null; render(); }
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }
  function toast(msg, bad) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, 3200);
  }
  const money = (n) => '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function hrs(h) {
    const mins = Math.round((h || 0) * 60);
    const H = Math.floor(mins / 60), M = mins % 60;
    return H ? `${H}h ${String(M).padStart(2, '0')}m` : `${M}m`;
  }
  const dec = (h) => (Math.round((h || 0) * 100) / 100).toFixed(2);
  function ymdParts(ymd) { const [y, m, d] = ymd.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  const fmtDay = (ymd, o = {}) => ymdParts(ymd).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', ...o });
  const fmtShort = (ymd) => ymdParts(ymd).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' });
  const dowLetter = (ymd) => ymdParts(ymd).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }).slice(0, 2);
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString('en-US', { timeZone: S.tz, hour: 'numeric', minute: '2-digit' });
  const fmtDT = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: S.tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  function ymdOf(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: S.tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  }
  function localInput(ms) {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: S.tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}T${String(+p.hour % 24).padStart(2, '0')}:${p.minute}`;
  }
  function addDays(ymd, n) { const d = ymdParts(ymd); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  const today = () => ymdOf(Date.now());
  const range = (a, b) => a === b ? fmtDay(a) : `${fmtShort(a)} – ${fmtShort(b)}`;
  function ago(ms) {
    const s = (Date.now() - ms) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
    return fmtDT(ms);
  }
  const initials = (n) => String(n || '?').split(/\s+/).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  const roleName = (r) => ({ owner: 'Owner', supervisor: 'Team lead / Supervisor', tech: 'Tech' }[r] || r);
  const mapLink = (lat, lng) => lat == null ? '' : `<a class="small" href="https://maps.google.com/?q=${lat},${lng}" target="_blank" rel="noopener">Map</a>`;

  const I = {
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16"/></svg>',
    plane: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h4l3-8h2l-1 8h5l2-3h2l-1 4 1 4h-2l-2-3h-5l1 8h-2l-3-8H3z"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5c2.3 0 4 1.5 4.5 4"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 13l2.5-8h11L20 13v6H4z"/><path d="M4 13h4.5l1 2h5l1-2H20"/></svg>',
    dollar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M16.5 7.5c-.6-1.4-2.3-2.3-4.5-2.3-2.6 0-4.3 1.3-4.3 3.2 0 4.4 9 2.3 9 6.8 0 1.9-1.9 3.4-4.7 3.4-2.4 0-4.2-1-4.8-2.6"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10" cy="8" r="4"/><path d="M3 21c.6-4 3.4-6.5 7-6.5"/><path d="M18 14v7M14.5 17.5h7"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    bank: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-5 9 5M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18"/></svg>',
    sick: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    wrench: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5.5a4 4 0 0 0 5 5l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-2-2z"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>'
  };
  const chev = `<span class="chev">${I.right.replace('<svg', '<svg width="18" height="18"')}</span>`;

  /* ---------- sheet (bottom modal) ---------- */
  function openSheet(title, html, onMount) {
    $sheet.innerHTML = `<div class="sheet-bg"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="sheet-grab"></div>
      <div class="sheet-head"><h3>${esc(title)}</h3><button class="icon-btn" data-close aria-label="Close">${I.x}</button></div><div class="sheet-body">${html}</div></div></div>`;
    const bg = $sheet.firstElementChild;
    bg.addEventListener('click', (e) => { if (e.target === bg || e.target.closest('[data-close]')) closeSheet(); });
    document.body.style.overflow = 'hidden';
    if (onMount) onMount($sheet.querySelector('.sheet-body'));
  }
  function closeSheet() { $sheet.innerHTML = ''; document.body.style.overflow = ''; }
  function confirmSheet(title, html, okLabel, okClass, fn) {
    openSheet(title, `${html}<div id="cf-err"></div><div class="btn-row" style="margin-top:18px"><button class="btn ghost" data-close>Cancel</button><button class="btn ${okClass || ''}" id="cf-ok">${esc(okLabel)}</button></div>`, (b) => {
      b.querySelector('#cf-ok').onclick = async (e) => {
        e.target.disabled = true;
        try { await fn(b); closeSheet(); } catch (err) { b.querySelector('#cf-err').innerHTML = `<div class="err" style="margin-top:14px">${esc(err.message)}</div>`; e.target.disabled = false; }
      };
    });
  }
  function bindForm(form, fn) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('[type=submit]');
      const errBox = form.querySelector('.form-err');
      if (btn) btn.disabled = true;
      if (errBox) errBox.innerHTML = '';
      try { await fn(Object.fromEntries(new FormData(form))); }
      catch (err) { if (errBox) errBox.innerHTML = `<div class="err">${esc(err.message)}</div>`; else toast(err.message, true); }
      finally { if (btn) btn.disabled = false; }
    });
  }

  /* ---------- location ---------- */
  function getLocation() {
    return new Promise((resolve) => {
      if (window.VT_FAKE_LOCATION) return resolve(window.VT_FAKE_LOCATION());
      if (!navigator.geolocation) return resolve(null);
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      setTimeout(() => finish(null), 9000);
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => finish(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
      );
    });
  }

  /* ---------- QR (SVG is generated by our own server) ---------- */
  function showLink(title, intro, url, name, qrSvg) {
    openSheet(title, `<p class="muted" style="margin-top:0">${intro}</p>
      <div class="qr-box" id="qr">${qrSvg || '<div class="muted small" style="color:#555;text-align:center">Use Copy link or Text it.</div>'}</div>
      <div class="linkbox" id="lnk">${esc(url)}</div>
      <div class="btn-row"><button class="btn ghost" id="cp">Copy link</button><a class="btn ghost" href="sms:?&body=${encodeURIComponent(`${name ? name + ', here' : 'Here'} is your VayTech app link: ${url}`)}">Text it</a></div>
      ${navigator.share ? '<button class="btn block" id="sh" style="margin-top:10px">Share…</button>' : ''}`, (b) => {
      b.querySelector('#cp').onclick = async () => { try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch { toast('Press and hold the link to copy'); } };
      const sh = b.querySelector('#sh');
      if (sh) sh.onclick = () => navigator.share({ title: 'VayTech', text: 'Your VayTech app link', url }).catch(() => {});
    });
  }

  /* ---------- boot & routing ---------- */
  async function boot() {
    try {
      S.boot = await api('GET', '/api/bootstrap');
      S.user = S.boot.user; S.tz = S.boot.settings.timezone;
    } catch (e) {
      $app.innerHTML = `<div class="auth"><div class="logo-mark">V</div><h1>Can't connect</h1><p class="sub">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
      return;
    }
    render();
  }
  function render() {
    clearInterval(S.timer); S.timer = null;
    const m = /^\/join\/([\w-]+)/.exec(location.pathname) || (window.VT_JOIN ? [0, window.VT_JOIN] : null);
    if (m) return renderJoin(m[1]);
    if (S.boot.setupNeeded) return renderSetup();
    if (!S.user) { clearInterval(S.poll); S.poll = null; return renderLogin(); }
    renderShell();
  }
  function tabsFor(role) {
    if (role === 'owner') return [['payroll', 'Payroll', I.dollar], ['team', 'Team', I.team], ['approvals', 'Requests', I.inbox], ['people', 'People', I.users]];
    if (role === 'supervisor') return [['clock', 'Clock', I.clock], ['hours', 'My pay', I.list], ['team', 'Team', I.team], ['approvals', 'Approve', I.inbox], ['timeoff', 'Time off', I.plane]];
    return [['clock', 'Clock', I.clock], ['hours', 'My pay', I.list], ['timeoff', 'Time off', I.plane]];
  }

  /* ---------- auth screens ---------- */
  function authPage(title, sub, form) {
    $app.innerHTML = `<div class="auth"><div class="logo-mark">V</div><div class="wordmark">${esc((S.boot?.settings.company_name || 'VayTech').toUpperCase())}</div><h1>${title}</h1><p class="sub">${sub}</p>${form}</div>`;
    return $app.querySelector('form');
  }
  function renderLogin() {
    const f = authPage('Sign in', 'Use the phone number or email you signed up with.', `<form>
      <div class="form-err"></div>
      <label class="f"><span>Phone or email</span><input class="input" name="login" autocomplete="username" inputmode="email" required></label>
      <label class="f"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required></label>
      <button class="btn block" type="submit">Sign in</button>
      <p class="muted small" style="text-align:center;margin-top:22px">Forgot your password? Ask the office for a reset link.<br>New here? Scan the QR code your boss sent you.</p></form>`);
    bindForm(f, async (d) => { await api('POST', '/api/login', d); await boot(); });
  }
  function renderSetup() {
    const f = authPage('Set up VayTech Time', 'Create the owner account. This is you — you\'ll see everyone\'s hours and pay.', `<form>
      <div class="form-err"></div>
      <label class="f"><span>Your name</span><input class="input" name="name" autocomplete="name" required></label>
      <label class="f"><span>Email</span><input class="input" name="email" type="email" autocomplete="email"></label>
      <label class="f"><span>Phone</span><input class="input" name="phone" type="tel" autocomplete="tel"></label>
      <label class="f"><span>Password (8+ characters)</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <button class="btn block" type="submit">Create owner account</button></form>`);
    bindForm(f, async (d) => { await api('POST', '/api/setup', d); await boot(); });
  }
  async function renderJoin(token) {
    $app.innerHTML = '<div class="auth"><div class="spin"></div></div>';
    let inv;
    try { inv = await api('GET', `/api/invite/${token}`); }
    catch (e) { authPage('Link not valid', esc(e.message), '<a class="btn block" href="/">Go to sign in</a>'); return; }
    const done = async () => { window.VT_JOIN = null; if (location.pathname.startsWith('/join/')) history.replaceState(null, '', '/'); await boot(); };
    if (inv.kind === 'reset') {
      const f = authPage('Set a new password', `Hi ${esc(inv.name)}. Pick a new password for your account.`, `<form><div class="form-err"></div>
        <label class="f"><span>New password (8+ characters)</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="f"><span>Type it again</span><input class="input" name="password2" type="password" autocomplete="new-password" required></label>
        <button class="btn block" type="submit">Save password</button></form>`);
      bindForm(f, async (d) => { if (d.password !== d.password2) throw new Error('Passwords do not match'); await api('POST', `/api/invite/${token}/accept`, { password: d.password }); toast('Password saved'); await done(); });
      return;
    }
    const f = authPage(`Welcome, ${esc(inv.name.split(' ')[0])}`, `Create your ${esc(inv.company)} account to clock in, see your hours and pay, and request time off.`, `<form><div class="form-err"></div>
      <label class="f"><span>Full name</span><input class="input" name="name" value="${esc(inv.name)}" autocomplete="name" required></label>
      <label class="f"><span>Mobile phone</span><input class="input" name="phone" type="tel" autocomplete="tel" placeholder="(555) 555-5555" required><div class="hint">You'll sign in with this number.</div></label>
      <label class="f"><span>Email (optional)</span><input class="input" name="email" type="email" autocomplete="email"></label>
      <label class="f"><span>Password (8+ characters)</span><input class="input" name="password" type="password" autocomplete="new-password" minlength="8" required></label>
      <label class="f"><span>Type it again</span><input class="input" name="password2" type="password" autocomplete="new-password" required></label>
      <button class="btn block" type="submit">Create my account</button></form>`);
    bindForm(f, async (d) => {
      if (d.password !== d.password2) throw new Error('Passwords do not match');
      await api('POST', `/api/invite/${token}/accept`, { name: d.name, phone: d.phone, email: d.email, password: d.password });
      toast('Account created'); await done();
    });
  }

  /* ---------- shell ---------- */
  function renderShell() {
    const tabs = tabsFor(S.user.role);
    if (!S.tab || !tabs.some((t) => t[0] === S.tab)) S.tab = tabs[0][0];
    $app.innerHTML = `
      <header class="topbar"><div class="topbar-in">
        <div class="brand"><div class="logo-mark">V</div>${esc(S.boot.settings.company_name.toUpperCase())}</div>
        <button class="icon-btn" id="bell" aria-label="Notifications">${I.bell}<span class="badge" id="bell-n" hidden></span></button>
        <button class="icon-btn" id="me" aria-label="Account"><span class="avatar">${esc(initials(S.user.name))}</span></button>
      </div></header>
      <main class="shell" id="view"></main>
      <nav class="tabbar"><div class="tabbar-in">${tabs.map(([k, l, ic]) => `<button class="tab ${k === S.tab ? 'active' : ''}" data-tab="${k}">${ic}<span>${l}</span>${k === 'approvals' ? '<span class="badge" id="appr-n" hidden></span>' : ''}</button>`).join('')}</div></nav>`;
    $app.querySelectorAll('[data-tab]').forEach((b) => { b.onclick = () => { S.tab = b.dataset.tab; window.scrollTo(0, 0); renderShell(); }; });
    $app.querySelector('#bell').onclick = openNotifications;
    $app.querySelector('#me').onclick = openAccount;
    updateBadge();
    if (!S.poll) {
      S.poll = setInterval(refreshCount, 30000);
      document.addEventListener('visibilitychange', () => { if (!document.hidden && S.user) { refreshCount(); if (S.tab === 'clock') showTab(); } });
    }
    refreshCount();
    showTab();
  }
  async function refreshCount() {
    if (!S.user) return;
    try { const r = await api('GET', '/api/notifications/count'); S.unread = r.unread; updateBadge(); } catch {}
    if (S.user.role !== 'tech') {
      try { const r = await api('GET', '/api/team/requests?status=pending'); const n = document.getElementById('appr-n'); if (n) { n.hidden = !r.items.length; n.textContent = r.items.length; } } catch {}
    }
  }
  function updateBadge() { const b = document.getElementById('bell-n'); if (b) { b.hidden = !S.unread; b.textContent = S.unread > 9 ? '9+' : S.unread; } }
  function showTab() {
    const v = document.getElementById('view');
    if (!v) return;
    v.innerHTML = '<div class="spin"></div>';
    const fn = { clock: viewClock, hours: viewHours, timeoff: viewTimeOff, team: viewTeam, approvals: viewApprovals, payroll: viewPayroll, people: viewPeople }[S.tab];
    fn(v).catch((e) => { v.innerHTML = `<div class="err">${esc(e.message)}</div><button class="btn ghost" id="rt">Try again</button>`; v.querySelector('#rt').onclick = showTab; });
  }

  async function openNotifications() {
    openSheet('Notifications', '<div class="spin"></div>');
    const r = await api('GET', '/api/notifications');
    const body = $sheet.querySelector('.sheet-body');
    if (!body) return;
    body.innerHTML = r.items.length ? `<div class="list">${r.items.map((n) => `<div class="notif ${n.read_at ? '' : 'unread'}"><div class="t">${n.read_at ? '' : '<span class="dot on"></span>'}${esc(n.title)}</div><div class="b">${esc(n.body)}</div><div class="w">${esc(ago(n.created_at))}</div></div>`).join('')}</div>` : '<div class="empty">No notifications yet.</div>';
    if (r.unread) { await api('POST', '/api/notifications/read', {}).catch(() => {}); S.unread = 0; updateBadge(); }
  }
  function openAccount() {
    openSheet('Account', `<div class="card"><div class="row"><span class="avatar" style="width:44px;height:44px;font-size:16px">${esc(initials(S.user.name))}</span><div class="grow"><div style="font-weight:700">${esc(S.user.name)}</div><div class="muted small">${esc(roleName(S.user.role))}</div></div></div>
      <div style="margin-top:12px">${S.user.phone ? `<div class="kv"><span>Phone</span><span>${esc(S.user.phone)}</span></div>` : ''}${S.user.email ? `<div class="kv"><span>Email</span><span>${esc(S.user.email)}</span></div>` : ''}${S.user.hourly_rate != null && S.user.role !== 'owner' ? `<div class="kv"><span>Pay rate</span><span>${money(S.user.hourly_rate)}/hr</span></div>` : ''}</div></div>
      ${installHelp()}
      <h2>Change password</h2>
      <form id="pw"><div class="form-err"></div>
      <label class="f"><span>Current password</span><input class="input" name="current" type="password" autocomplete="current-password" required></label>
      <label class="f"><span>New password</span><input class="input" name="next" type="password" minlength="8" autocomplete="new-password" required></label>
      <button class="btn ghost block" type="submit">Update password</button></form>
      <button class="btn danger block" id="lo" style="margin-top:18px">Sign out</button>`, (b) => {
      bindForm(b.querySelector('#pw'), async (d) => { await api('POST', '/api/me/password', d); toast('Password updated'); closeSheet(); });
      b.querySelector('#lo').onclick = async () => { await api('POST', '/api/logout', {}).catch(() => {}); closeSheet(); S.user = null; S.tab = null; render(); };
    });
  }
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  function installHelp() {
    if (standalone()) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<div class="banner" style="margin-top:10px"><div><b>Put this app on your home screen</b><div class="muted small">${ios ? 'In Safari tap the Share button, then “Add to Home Screen”.' : 'In Chrome tap the ⋮ menu, then “Add to Home screen” or “Install app”.'}</div></div></div>`;
  }
  function installBanner() {
    let hidden = false;
    try { hidden = localStorage.getItem('vt_install_hide') === '1'; } catch {}
    if (hidden || standalone()) return '';
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    return `<div class="banner" id="ib"><div class="grow"><b>Add VayTech to your home screen</b><div class="muted small">${ios ? 'Tap Share, then “Add to Home Screen”.' : 'Tap ⋮ in Chrome, then “Add to Home screen”.'}</div></div><button class="x" aria-label="Dismiss">×</button></div>`;
  }
  function bindInstallBanner(v) {
    const ib = v.querySelector('#ib');
    if (ib) ib.querySelector('.x').onclick = () => { try { localStorage.setItem('vt_install_hide', '1'); } catch {} ib.remove(); };
  }

  /* ---------- views: worker ---------- */
  function weekBars(w) {
    const max = Math.max(8, ...w.days.map((d) => d.hours));
    const t = today();
    return `<div class="bars">${w.days.map((d) => `<div class="bar"><b>${d.hours ? dec(d.hours).replace(/\.00$/, '') : ''}</b><i class="${d.hours ? '' : 'zero'} ${d.date === t ? 'today' : ''}" style="height:${Math.max(3, (d.hours / max) * 70)}px"></i><span>${dowLetter(d.date)}</span></div>`).join('')}</div>`;
  }
  const etaText = (p) => p.eta ? (p.eta <= today() ? 'Arrived ' : 'Arriving ') + fmtDay(p.eta) : 'Sent ' + fmtShort(ymdOf(p.paid_at));
  function payStatus(w) {
    if (w.payment) return `<span class="pill on">${I.check.replace('<svg', '<svg width="13" height="13"')} ${esc(etaText(w.payment))}</span>`;
    return `<span class="pill">Pays ${esc(fmtDay(w.pay_date))}</span>`;
  }
  function shiftList(entries, opts = {}) {
    if (!entries.length) return '<div class="list"><div class="empty">No shifts yet this week.</div></div>';
    return `<div class="list">${[...entries].reverse().map((e) => {
      const h = ((e.clock_out || Date.now()) - e.clock_in) / 3600000;
      const long = !e.clock_out && h > 12;
      return `<${opts.edit ? `button class="item" data-entry="${e.id}"` : 'div class="item"'}>
        <div class="grow"><div class="t">${esc(fmtDay(ymdOf(e.clock_in)))}</div>
        <div class="s num">${esc(fmtTime(e.clock_in))} – ${e.clock_out ? esc(fmtTime(e.clock_out)) : '<span style="color:var(--on)">on the clock</span>'}${e.auto_capped ? '' : e.edited ? ' · edited' : ''}</div>
        ${e.auto_capped ? '<div class="changed">Never clocked out · app ended it automatically</div>' : ''}
        ${opts.edit ? `<div class="s">${e.in_lat != null ? `In ${mapLink(e.in_lat, e.in_lng)}` : 'In: no location'}${e.clock_out ? (e.out_lat != null ? ` · Out ${mapLink(e.out_lat, e.out_lng)}` : (e.created_by === e.user_id ? ' · Out: no location' : '')) : ''}</div>` : ''}
        ${long ? '<div class="changed">Open over 12 hours — did they forget to clock out?</div>' : ''}</div>
        <div class="r num" style="font-weight:700">${hrs(h)}</div>${opts.edit ? chev : ''}</${opts.edit ? 'button' : 'div'}>`;
    }).join('')}</div>`;
  }

  async function viewClock(v) {
    const d = await api('GET', '/api/me/dashboard');
    const w = d.week; const open = d.open;
    v.innerHTML = `${installBanner()}
      <div class="card clock-card">
        <div class="clock-status">${open ? `<span class="pill on"><span class="dot on"></span> On the clock since ${esc(fmtTime(open.clock_in))}</span>` : 'You are clocked out'}</div>
        <div class="clock-timer num" id="tm">${open ? '' : esc(new Date().toLocaleTimeString('en-US', { timeZone: S.tz, hour: 'numeric', minute: '2-digit' }))}</div>
        <button class="clock-btn ${open ? 'out' : ''}" id="cb">${I.clock}${open ? 'CLOCK OUT' : 'CLOCK IN'}</button>
        <div class="loc-note">${I.pin} Your location is saved when you clock in and out</div>
        ${d.settings.max_shift_hours ? `<div class="loc-note" style="margin-top:6px">Forget to clock out? Your shift ends on its own after ${d.settings.max_shift_hours} hours.</div>` : ''}
      </div>
      <h2>This week · ${esc(range(w.week_start, w.week_end))}</h2>
      <div class="split">
        <div class="card"><div class="stat-label">Hours</div><div class="stat-big num" id="wk-h">${dec(w.hours)}</div><div class="muted small" style="margin-top:6px">${w.overtime ? `${dec(w.regular)} reg + <b style="color:var(--warn)">${dec(w.overtime)} OT</b>` : (d.settings.ot_enabled ? `${dec(Math.max(0, d.settings.ot_threshold - w.hours))} until overtime` : hrs(w.hours) + ' worked')}</div></div>
        <div class="card"><div class="stat-label">Est. pay</div><div class="stat-big num">${money(w.gross).replace(/\.\d\d$/, '')}<span style="font-size:20px">${money(w.gross).slice(-3)}</span></div><div class="muted small" style="margin-top:6px">${money(w.rate)}/hr${w.overtime ? ` · OT ${money(w.rate * d.settings.ot_multiplier)}` : ''}</div></div>
      </div>
      <div class="card deposit">${I.bank}<div class="grow"><div style="font-weight:700">Deposit: ${esc(fmtDay(w.pay_date, { weekday: 'long' }))}</div><div class="muted small">Pay for this week is sent ${esc(fmtDay(w.pay_date))}. You'll get a notification when it's sent.</div></div></div>
      <div class="card">${weekBars(w)}</div>
      <h2>Shifts this week</h2>${shiftList(w.entries)}
      <p class="muted small" style="margin-top:14px">Forgot to clock in or out? Go to <b>Time off</b> → <b>Fix my hours</b> and your lead will correct it.</p>`;
    bindInstallBanner(v);
    if (open) {
      const tick = () => { const s = Math.floor((Date.now() - open.clock_in) / 1000); const el = document.getElementById('tm'); if (el) el.textContent = `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
      tick(); S.timer = setInterval(tick, 1000);
    }
    v.querySelector('#cb').onclick = async (e) => {
      const btn = e.currentTarget; btn.disabled = true;
      btn.lastChild.textContent = 'GETTING LOCATION…';
      const pos = await getLocation();
      try {
        const r = await api('POST', open ? '/api/clock/out' : '/api/clock/in', pos || {});
        if (r.capped) toast(`You went over ${r.hours} hours, so your shift was ended at ${r.hours} hours`, true);
        else toast(open ? 'Clocked out' + (pos ? '' : ' (no location)') : 'Clocked in' + (pos ? '' : ' (no location)'));
      } catch (err) { toast(err.message, true); }
      clearInterval(S.timer); showTab();
    };
  }

  async function viewHours(v) {
    const d = await api('GET', '/api/me/dashboard');
    const weeks = [d.week, ...d.history];
    v.innerHTML = `<h1>My pay</h1>
      <div class="card"><div class="stat-label">This week so far</div><div class="row between"><div class="stat-big num">${money(d.week.gross)}</div>${payStatus(d.week)}</div>
      <div class="muted small" style="margin-top:8px">${dec(d.week.hours)} hours${d.week.overtime ? ` · ${dec(d.week.overtime)} overtime` : ''} · paid weekly</div></div>
      <h2>Weeks</h2><div class="list">${weeks.map((w) => `<button class="item" data-wk="${w.week_start}"><div class="grow"><div class="t">${esc(range(w.week_start, w.week_end))}</div><div class="s num">${dec(w.hours)} hrs${w.overtime ? ` · ${dec(w.overtime)} OT` : ''}</div></div>
        <div class="r"><div class="num" style="font-weight:700">${money(w.payment ? w.payment.amount : w.gross)}</div><div style="margin-top:3px">${payStatus(w)}</div></div>${chev}</button>`).join('')}</div>
      <p class="muted small" style="margin-top:14px">Estimated gross pay before taxes: your hours × ${money(d.week.rate)}/hr.${d.settings.ot_enabled ? ` Overtime is paid at ${d.settings.ot_multiplier}× after ${d.settings.ot_threshold} hours in a week.` : ''}</p>`;
    v.querySelectorAll('[data-wk]').forEach((b) => { b.onclick = () => openMyWeek(b.dataset.wk); });
  }
  async function openMyWeek(start) {
    openSheet('Week', '<div class="spin"></div>');
    const w = await api('GET', `/api/me/week?start=${start}`);
    const b = $sheet.querySelector('.sheet-body'); if (!b) return;
    $sheet.querySelector('.sheet-head h3').textContent = range(w.week_start, w.week_end);
    b.innerHTML = `<div class="card"><div class="kv"><span>Total hours</span><span class="num">${dec(w.hours)}</span></div><div class="kv"><span>Regular</span><span class="num">${dec(w.regular)}</span></div><div class="kv"><span>Overtime</span><span class="num">${dec(w.overtime)}</span></div>
      <div class="kv"><span>Gross pay</span><span class="num" style="font-weight:700">${money(w.gross)}</span></div>
      <div class="kv"><span>Deposit</span><span>${w.payment ? `Sent ${esc(fmtShort(ymdOf(w.payment.paid_at)))}` : `Pays ${esc(fmtDay(w.pay_date))}`}</span></div>
      ${w.payment && w.payment.eta ? `<div class="kv"><span>Arrives</span><span style="font-weight:700;color:var(--on)">${esc(fmtDay(w.payment.eta))}</span></div>` : ''}</div>
      <div class="card">${weekBars(w)}</div><h2>Shifts</h2>${shiftList(w.entries)}`;
  }

  async function viewTimeOff(v) {
    const r = await api('GET', '/api/requests');
    const notice = S.boot.settings.timeoff_notice_days;
    v.innerHTML = `<h1>Time off</h1>
      <div class="action-grid">
        <button class="action" data-new="time_off"><span class="ic">${I.cal}</span><span class="grow"><div class="t">Request a day off</div><div class="s">At least ${notice} days ahead · your supervisor approves</div></span>${chev}</button>
        <button class="action" data-new="sick"><span class="ic">${I.sick}</span><span class="grow"><div class="t">Call in sick</div><div class="s">Today or any day you need</div></span>${chev}</button>
        <button class="action" data-new="correction"><span class="ic">${I.wrench}</span><span class="grow"><div class="t">Fix my hours</div><div class="s">Forgot to clock in or out</div></span>${chev}</button>
      </div>
      <h2>My requests</h2>${requestList(r.items, false)}`;
    v.querySelectorAll('[data-new]').forEach((b) => { b.onclick = () => newRequest(b.dataset.new); });
    v.querySelectorAll('[data-cancel]').forEach((b) => {
      b.onclick = () => confirmSheet('Cancel request?', '<p class="muted">Your supervisor will no longer see it.</p>', 'Cancel request', 'danger', async () => { await api('POST', `/api/requests/${b.dataset.cancel}/cancel`, {}); toast('Request cancelled'); showTab(); });
    });
  }
  function statusPill(s) { return `<span class="pill ${{ approved: 'on', pending: 'warn', denied: 'bad' }[s] || ''}">${esc({ approved: 'Approved', pending: 'Waiting', denied: 'Denied', cancelled: 'Cancelled' }[s])}</span>`; }
  function requestList(items, manage) {
    if (!items.length) return `<div class="list"><div class="empty">${manage ? 'Nothing here.' : 'No requests yet.'}</div></div>`;
    return items.map((r) => `<div class="card">
      <div class="row between"><div class="grow"><div style="font-weight:700">${manage ? esc(r.user_name) + ' · ' : ''}${esc(r.type_label)}</div><div class="muted small">${esc(range(r.start_date, r.end_date))}</div></div>${statusPill(r.status)}</div>
      ${r.reason ? `<div style="margin-top:10px;font-size:14px">${esc(r.reason)}</div>` : ''}
      <div class="trail">
        <div><span class="dot"></span><span><b>Requested</b>${manage ? ` by ${esc(r.user_name)}` : ''} · ${esc(fmtDT(r.created_at))}</span></div>
        ${r.decided_at && (r.status === 'approved' || r.status === 'denied') ? `<div><span class="dot ${r.status === 'approved' ? 'on' : 'bad'}"></span><span><b>${r.type === 'correction' ? (r.status === 'approved' ? 'Fixed' : 'Not changed') : r.status === 'approved' ? 'Approved' : 'Denied'}</b> by ${esc(r.decided_by_name || 'someone')}${r.decided_by_role === 'owner' ? ' (owner)' : ''} · ${esc(fmtDT(r.decided_at))}${r.decision_note ? `<br><span class="muted">“${esc(r.decision_note)}”</span>` : ''}</span></div>` : ''}
        ${r.status === 'cancelled' ? '<div><span class="dot"></span><span>Cancelled by the person who asked</span></div>' : ''}
        ${r.status === 'pending' ? '<div><span class="dot warn"></span><span class="muted">Waiting for a decision</span></div>' : ''}
      </div>
      ${manage && r.status === 'pending' ? `<div class="btn-row" style="margin-top:14px"><button class="btn danger sm" data-deny="${r.id}">Deny</button>${r.type === 'correction' ? `<button class="btn ghost sm" data-fixhours="${r.user_id}" data-day="${r.start_date}">Open hours</button>` : ''}<button class="btn ok sm" data-approve="${r.id}">${r.type === 'correction' ? 'Mark fixed' : 'Approve'}</button></div>` : ''}
      ${!manage && r.status === 'pending' ? `<button class="btn ghost sm" style="margin-top:12px" data-cancel="${r.id}">Cancel</button>` : ''}
      </div>`).join('');
  }
  function newRequest(type) {
    const notice = S.boot.settings.timeoff_notice_days;
    const t = today();
    const minOff = addDays(t, notice);
    const cfg = {
      time_off: { title: 'Request a day off', min: minOff, max: '', start: minOff, note: `Pick dates on or after ${fmtDay(minOff)} (${notice} days notice).`, reason: 'Reason (optional)' },
      sick: { title: 'Call in sick', min: addDays(t, -14), max: addDays(t, 30), start: t, note: 'Your supervisor gets notified right away.', reason: 'Anything they should know? (optional)' },
      correction: { title: 'Fix my hours', min: addDays(t, -30), max: t, start: t, note: 'Tell your lead what happened. They will fix your hours.', reason: 'What needs fixing? (e.g. “Forgot to clock out, left at 4:30 PM”)' }
    }[type];
    openSheet(cfg.title, `<form><div class="form-err"></div>
      <div class="split"><label class="f"><span>${type === 'correction' ? 'Day' : 'From'}</span><input class="input" type="date" name="start_date" value="${cfg.start}" min="${cfg.min}" ${cfg.max ? `max="${cfg.max}"` : ''} required></label>
      ${type === 'correction' ? '<div></div>' : `<label class="f"><span>To</span><input class="input" type="date" name="end_date" value="${cfg.start}" min="${cfg.min}" required></label>`}</div>
      <p class="hint" style="margin:-4px 0 14px">${esc(cfg.note)}</p>
      <label class="f"><span>${esc(cfg.reason)}</span><textarea class="input" name="reason" ${type === 'correction' ? 'required' : ''}></textarea></label>
      <button class="btn block" type="submit">Send to supervisor</button></form>`, (b) => {
      const f = b.querySelector('form');
      const s = f.start_date, e = f.end_date;
      if (e) s.addEventListener('change', () => { e.min = s.value; if (e.value < s.value) e.value = s.value; });
      bindForm(f, async (d) => { await api('POST', '/api/requests', { type, ...d, end_date: d.end_date || d.start_date }); closeSheet(); toast('Request sent'); showTab(); });
    });
  }

  /* ---------- views: team / approvals ---------- */
  async function viewTeam(v) {
    const d = await api('GET', '/api/team');
    const isOwner = S.user.role === 'owner';
    let people = d.people.filter((p) => p.active);
    const hasCrew = !isOwner && people.some((p) => p.lead_id === S.user.id);
    if (hasCrew && S.crewOnly) people = people.filter((p) => p.lead_id === S.user.id);
    const on = people.filter((p) => p.open);
    v.innerHTML = `<h1>Team</h1>
      ${hasCrew ? `<div class="seg"><button class="${S.crewOnly ? 'on' : ''}" data-crew="1">My crew</button><button class="${S.crewOnly ? '' : 'on'}" data-crew="0">Everyone</button></div>` : ''}
      <div class="split" style="margin-bottom:6px"><div class="card"><div class="stat-label">On the clock</div><div class="stat-big num">${on.length}<span class="muted" style="font-size:18px"> / ${people.length}</span></div></div>
      <div class="card"><div class="stat-label">${isOwner ? 'Pay this week' : 'Hours this week'}</div><div class="stat-big num" style="font-size:${isOwner ? 30 : 40}px">${isOwner ? money(people.reduce((a, p) => a + (p.week_gross || 0), 0)) : dec(people.reduce((a, p) => a + p.week_hours, 0))}</div></div></div>
      <h2>People</h2>
      ${people.length ? `<div class="list">${people.map((p) => {
        const long = p.open && (Date.now() - p.open.clock_in) > 12 * 3600000;
        return `<button class="item" data-p="${p.id}"><span class="dot ${p.open ? 'on' : ''}"></span><div class="grow"><div class="t">${esc(p.name)}</div>
        <div class="s">${p.open ? `In since ${esc(fmtTime(p.open.clock_in))}${p.open.in_lat != null ? '' : ' · no location'}` : 'Off the clock'}${p.role === 'supervisor' ? ' · Lead' : ''}</div>${long ? '<div class="changed">Clocked in over 12 hrs</div>' : ''}</div>
        <div class="r"><div class="num" style="font-weight:700">${dec(p.week_hours)}h</div>${p.week_overtime ? `<div class="small" style="color:var(--warn)">${dec(p.week_overtime)} OT</div>` : ''}</div>${chev}</button>`;
      }).join('')}</div>` : `<div class="list"><div class="empty">${isOwner ? 'No one yet. Go to People to add your techs.' : 'No techs assigned yet.'}</div></div>`}`;
    v.querySelectorAll('[data-crew]').forEach((b) => { b.onclick = () => { S.crewOnly = b.dataset.crew === '1'; showTab(); }; });
    v.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => openPerson(Number(b.dataset.p)); });
  }
  async function openPerson(id, start) {
    openSheet('…', '<div class="spin"></div>');
    let d;
    try { d = await api('GET', `/api/team/${id}/week${start ? `?start=${start}` : ''}`); } catch (e) { const b = $sheet.querySelector('.sheet-body'); if (b) b.innerHTML = `<div class="err">${esc(e.message)}</div>`; return; }
    const b = $sheet.querySelector('.sheet-body'); if (!b) return;
    const w = d.week; const isOwner = S.user.role === 'owner';
    const curStart = w.week_start;
    $sheet.querySelector('.sheet-head h3').textContent = d.person.name;
    b.innerHTML = `<div class="weeknav"><button class="icon-btn" id="pv" aria-label="Previous week">${I.left}</button><div class="lbl">${esc(range(w.week_start, w.week_end))}<small>${w.week_start <= today() && today() <= w.week_end ? 'This week' : `Pays ${esc(fmtDay(w.pay_date))}`}</small></div><button class="icon-btn" id="nx" aria-label="Next week" ${today() <= w.week_end ? 'disabled style="opacity:.3"' : ''}>${I.right}</button></div>
      <div class="card"><div class="kv"><span>Hours</span><span class="num">${dec(w.hours)}${w.overtime ? ` <span style="color:var(--warn)">(${dec(w.overtime)} OT)</span>` : ''}</span></div>
      ${isOwner ? `<div class="kv"><span>Rate</span><span class="num">${money(w.rate)}/hr</span></div><div class="kv"><span>Gross pay</span><span class="num" style="font-weight:700">${money(w.gross)}</span></div><div class="kv"><span>Payment</span><span>${w.payment ? `<span class="pill on">${esc(etaText(w.payment))}</span>` : 'Not sent'}</span></div>` : ''}
      ${d.person.phone ? `<div class="kv"><span>Phone</span><a href="tel:${esc(d.person.phone)}">${esc(d.person.phone)}</a></div>` : ''}</div>
      ${isOwner && w.payment && Math.abs(w.payment.amount - w.gross) >= 0.01 ? `<div class="err" style="background:var(--warn-bg);color:var(--warn)">Hours changed after this week was paid. Paid ${money(w.payment.amount)}, now ${money(w.gross)}.</div>` : ''}
      <div class="row between" style="margin:22px 0 10px"><h2 style="margin:0">Shifts</h2><button class="btn sm" id="add">+ Add shift</button></div>
      ${shiftList(w.entries, { edit: true })}
      ${d.edits.length ? `<h2>Recent changes</h2><div class="list">${d.edits.slice(0, 8).map((x) => `<div class="item" style="cursor:default"><div class="grow"><div class="s">${x.action === 'auto' ? 'App ended a shift automatically' : `${esc(x.editor_name)} ${{ add: 'added', edit: 'edited', delete: 'removed' }[x.action]} a shift`} · ${esc(ago(x.at))}</div><div style="font-size:14px">${esc(x.reason)}</div></div></div>`).join('')}</div>` : ''}`;
    b.querySelector('#pv').onclick = () => openPerson(id, addDays(curStart, -7));
    const nx = b.querySelector('#nx'); if (!nx.disabled) nx.onclick = () => openPerson(id, addDays(curStart, 7));
    b.querySelector('#add').onclick = () => editEntry(id, null, curStart);
    b.querySelectorAll('[data-entry]').forEach((el) => { el.onclick = (e) => { if (e.target.closest('a')) return; editEntry(id, w.entries.find((x) => x.id === Number(el.dataset.entry)), curStart); }; });
  }
  function editEntry(personId, entry, weekStart) {
    const defIn = entry ? localInput(entry.clock_in) : `${today() <= addDays(weekStart, 6) ? today() : weekStart}T07:00`;
    const defOut = entry ? (entry.clock_out ? localInput(entry.clock_out) : '') : `${defIn.slice(0, 10)}T15:30`;
    const nowIn = localInput(Date.now());
    openSheet(entry ? 'Edit shift' : 'Add shift', `<form><div class="form-err"></div>
      <label class="f"><span>Clock in</span><input class="input" type="datetime-local" name="clock_in" value="${defIn}" max="${nowIn}" required></label>
      <label class="f"><span>Clock out</span><input class="input" type="datetime-local" name="clock_out" value="${defOut}" max="${nowIn}"><div class="hint">Leave empty only if they are still working.</div></label>
      <label class="f"><span>Reason (they will see this)</span><input class="input" name="reason" placeholder="e.g. Forgot to clock out" required></label>
      <button class="btn block" type="submit">${entry ? 'Save changes' : 'Add shift'}</button>
      ${entry ? '<button type="button" class="btn danger block" id="del" style="margin-top:10px">Remove shift</button>' : ''}</form>`, (b) => {
      const f = b.querySelector('form');
      const after = (r) => { if (r.paid_week) toast('Saved. Note: that week was already paid.', true); else toast('Saved — they were notified'); openPerson(personId, weekStart); };
      bindForm(f, async (d) => {
        const r = entry ? await api('PUT', `/api/entries/${entry.id}`, d) : await api('POST', `/api/team/${personId}/entries`, d);
        after(r);
      });
      const del = b.querySelector('#del');
      if (del) del.onclick = async () => {
        const reason = f.reason.value.trim();
        if (!reason) { f.querySelector('.form-err').innerHTML = '<div class="err">Type a reason first, then tap Remove.</div>'; f.reason.focus(); return; }
        del.disabled = true;
        try { after(await api('DELETE', `/api/entries/${entry.id}`, { reason })); } catch (e) { del.disabled = false; f.querySelector('.form-err').innerHTML = `<div class="err">${esc(e.message)}</div>`; }
      };
    });
  }

  async function viewApprovals(v) {
    S.reqType = S.reqType || ''; S.reqUser = S.reqUser || '';
    const r = await api('GET', `/api/team/requests?status=${S.apprStatus}&type=${S.reqType}&user=${S.reqUser}`);
    const counts = r.items.reduce((a, x) => { a[x.status] = (a[x.status] || 0) + 1; return a; }, {});
    v.innerHTML = `<h1>Requests</h1>
      <div class="seg">${[['pending', 'Waiting'], ['approved', 'Approved'], ['denied', 'Denied'], ['all', 'All']].map(([k, l]) => `<button class="${S.apprStatus === k ? 'on' : ''}" data-st="${k}">${l}</button>`).join('')}</div>
      <div class="split" style="margin-bottom:12px">
        <select class="input" id="f-type" aria-label="Type"><option value="">All types</option><option value="time_off" ${S.reqType === 'time_off' ? 'selected' : ''}>Day off</option><option value="sick" ${S.reqType === 'sick' ? 'selected' : ''}>Sick leave</option><option value="correction" ${S.reqType === 'correction' ? 'selected' : ''}>Hours fix</option></select>
        <select class="input" id="f-user" aria-label="Person"><option value="">Everyone</option>${r.people.map((p) => `<option value="${p.id}" ${String(p.id) === String(S.reqUser) ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
      </div>
      ${S.apprStatus === 'all' && r.items.length ? `<p class="muted small" style="margin:0 0 12px">${r.items.length} request${r.items.length === 1 ? '' : 's'} · ${counts.approved || 0} approved · ${counts.denied || 0} denied · ${counts.pending || 0} waiting${counts.cancelled ? ` · ${counts.cancelled} cancelled` : ''}. Newest first.</p>` : ''}
      ${requestList(r.items, true)}`;
    v.querySelectorAll('[data-st]').forEach((b) => { b.onclick = () => { S.apprStatus = b.dataset.st; showTab(); }; });
    v.querySelector('#f-type').onchange = (e) => { S.reqType = e.target.value; showTab(); };
    v.querySelector('#f-user').onchange = (e) => { S.reqUser = e.target.value; showTab(); };
    const decide = (id, status) => {
      const item = r.items.find((x) => x.id === Number(id));
      const verb = status === 'approved' ? (item.type === 'correction' ? 'Mark as fixed' : 'Approve') : 'Deny';
      confirmSheet(`${verb}?`, `<p class="muted" style="margin-top:0">${esc(item.user_name)} · ${esc(item.type_label)} · ${esc(range(item.start_date, item.end_date))}</p>
        <label class="f"><span>Note to ${esc(item.user_name.split(' ')[0])} (optional)</span><input class="input" id="dn" placeholder="${status === 'denied' ? 'e.g. We are short-staffed that week' : 'e.g. Enjoy your time off'}"></label>`,
        verb, status === 'approved' ? 'ok' : 'danger', async (b) => {
          await api('POST', `/api/team/requests/${id}/decide`, { status, note: b.querySelector('#dn').value });
          toast(`${status === 'approved' ? 'Approved' : 'Denied'} — ${item.user_name.split(' ')[0]} was notified`); showTab(); refreshCount();
        });
    };
    v.querySelectorAll('[data-approve]').forEach((b) => { b.onclick = () => decide(b.dataset.approve, 'approved'); });
    v.querySelectorAll('[data-deny]').forEach((b) => { b.onclick = () => decide(b.dataset.deny, 'denied'); });
    v.querySelectorAll('[data-fixhours]').forEach((b) => { b.onclick = () => openPerson(Number(b.dataset.fixhours), b.dataset.day); });
  }

  /* ---------- views: owner ---------- */
  async function viewPayroll(v) {
    const d = await api('GET', `/api/admin/payroll${S.payWeek ? `?week=${S.payWeek}` : ''}`);
    S.payWeek = d.week_start;
    const rows = d.rows.filter((r) => !r.idle);
    const t = d.totals;
    v.innerHTML = `<h1>Payroll</h1>
      <div class="weeknav"><button class="icon-btn" id="pv" aria-label="Previous week">${I.left}</button><div class="lbl">${esc(range(d.week_start, d.week_end))}<small>${d.is_current ? `This week · pays ${esc(fmtDay(d.pay_date))}` : `Payday ${esc(fmtDay(d.pay_date))}${d.pay_date === today() ? ' · today' : d.pay_date > today() ? ` · in ${Math.round((ymdParts(d.pay_date) - ymdParts(today())) / 86400000)} days` : ' · due'}`}</small></div><button class="icon-btn" id="nx" aria-label="Next week" ${d.is_current ? 'disabled style="opacity:.3"' : ''}>${I.right}</button></div>
      <div style="text-align:center;margin:-6px 0 14px"><button class="btn ghost sm" id="chpd">Change payday for this week</button></div>
      <div class="split"><div class="card"><div class="stat-label">Left to pay</div><div class="stat-big num" style="font-size:30px">${money(t.unpaid)}</div><div class="muted small" style="margin-top:6px">${t.people - t.paid_count} of ${t.people} people</div></div>
      <div class="card"><div class="stat-label">Week total</div><div class="stat-big num" style="font-size:30px">${money(t.gross)}</div><div class="muted small" style="margin-top:6px">${dec(t.hours)} hrs · ${money(t.paid)} sent</div></div></div>
      ${d.is_current ? '<div class="banner" style="margin-top:10px"><div class="muted small">This week isn\'t over yet. Amounts will keep growing as people work. Tap ‹ to see earlier weeks.</div></div>' : ''}
      <h2>Tap the box once you've sent the money</h2>
      ${rows.length ? `<div class="list">${rows.map((r) => `<div class="pay-row">
        <button class="check ${r.payment ? 'done' : ''}" data-pay="${r.user_id}" aria-label="${r.payment ? 'Paid' : 'Mark paid'}" ${!r.payment && (r.open || r.gross <= 0) ? 'disabled' : ''}>${I.check}</button>
        <div class="grow"><div style="font-weight:700">${esc(r.name)}</div><div class="muted small num">${dec(r.hours)} hrs${r.overtime ? ` · ${dec(r.overtime)} OT` : ''} · ${money(r.rate)}/hr</div>
        ${r.payment ? `<div class="small" style="color:var(--on)">Sent ${esc(fmtShort(ymdOf(r.payment.paid_at)))}${r.payment.eta ? ` · arrives ${esc(fmtDay(r.payment.eta))}` : ''}</div>` : ''}
        ${r.changed ? `<div class="changed">Hours changed after paying: now ${money(r.gross)} (${r.gross > r.payment.amount ? 'owes' : 'over by'} ${money(Math.abs(r.gross - r.payment.amount))})</div>` : ''}
        ${r.open ? '<div class="changed">Still clocked in — clock them out in Team first</div>' : ''}</div>
        <div class="r num" style="font-weight:800;font-size:17px">${money(r.payment ? r.payment.amount : r.gross)}</div></div>`).join('')}</div>` : '<div class="list"><div class="empty">No hours for this week.</div></div>'}
      ${rows.length ? `<a class="btn ghost block" style="margin-top:14px" href="/api/admin/payroll.csv?week=${d.week_start}">Download spreadsheet (CSV)</a>` : ''}`;
    v.querySelector('#chpd').onclick = () => {
      openSheet('Change payday', `<p class="muted" style="margin-top:0">For the week of <b style="color:var(--text)">${esc(range(d.week_start, d.week_end))}</b> only. Your normal schedule (Settings) stays the same for other weeks.</p>
        <label class="f"><span>Pay date</span><input class="input" type="date" id="pdd" value="${d.pay_date}" min="${addDays(d.week_end, 1)}"></label>
        <p class="hint" style="margin:-6px 0 14px">Normal payday for this week: ${esc(fmtDay(d.normal_pay_date))}. Everyone with unpaid hours this week is notified of the change.</p>
        <div id="pd-err"></div><button class="btn block" id="pd-save">Save pay date</button>
        ${d.pay_date !== d.normal_pay_date ? `<button class="btn ghost block" id="pd-reset" style="margin-top:10px">Back to normal (${esc(fmtDay(d.normal_pay_date))})</button>` : ''}`, (bd) => {
        const go = async (val, btn) => {
          btn.disabled = true;
          try { const r = await api('POST', '/api/admin/payroll/paydate', { week_start: d.week_start, pay_date: val }); closeSheet(); toast(`Payday set to ${fmtDay(r.pay_date)}${r.notified ? ` — ${r.notified} people notified` : ''}`); showTab(); }
          catch (x) { bd.querySelector('#pd-err').innerHTML = `<div class="err">${esc(x.message)}</div>`; btn.disabled = false; }
        };
        bd.querySelector('#pd-save').onclick = (e) => go(bd.querySelector('#pdd').value, e.target);
        const rs = bd.querySelector('#pd-reset'); if (rs) rs.onclick = (e) => go(null, e.target);
      });
    };
    v.querySelector('#pv').onclick = () => { S.payWeek = addDays(d.week_start, -7); showTab(); };
    const nx = v.querySelector('#nx'); if (!nx.disabled) nx.onclick = () => { S.payWeek = addDays(d.week_start, 7); showTab(); };
    v.querySelectorAll('[data-pay]').forEach((b) => {
      b.onclick = () => {
        const r = rows.find((x) => x.user_id === Number(b.dataset.pay));
        const first = r.name.split(' ')[0];
        const etaInput = (val) => `<label class="f"><span>When will the money arrive?</span><input class="input" type="date" id="eta" value="${val}" min="${today()}" max="${addDays(today(), 30)}" required><div class="hint">${esc(first)} sees this date on their pay screen and in the notification.</div></label>`;
        if (r.payment) {
          openSheet(r.name, `<div class="card"><div class="kv"><span>Paid</span><span class="num" style="font-weight:800">${money(r.payment.amount)}</span></div><div class="kv"><span>Sent</span><span>${esc(fmtDT(r.payment.paid_at))}</span></div><div class="kv"><span>Marked by</span><span>${esc(r.payment.paid_by_name || 'you')}</span></div></div>
            <h2>Arrival date</h2>${etaInput(r.payment.eta && r.payment.eta >= today() ? r.payment.eta : defaultEta())}
            <div id="pe-err"></div><button class="btn block" id="pe-save">Update arrival date</button>
            <h2>Not actually sent?</h2><button class="btn danger block" id="pe-undo">Undo — mark as not paid</button>`, (bd) => {
            const err = (m) => { bd.querySelector('#pe-err').innerHTML = `<div class="err">${esc(m)}</div>`; };
            bd.querySelector('#pe-save').onclick = async (e) => {
              e.target.disabled = true;
              try { await api('POST', '/api/admin/payroll/eta', { user_id: r.user_id, week_start: d.week_start, eta: bd.querySelector('#eta').value }); closeSheet(); toast(`Arrival date updated — ${first} was notified`); showTab(); }
              catch (x) { err(x.message); e.target.disabled = false; }
            };
            let armed = false;
            bd.querySelector('#pe-undo').onclick = async (e) => {
              if (!armed) { armed = true; e.target.textContent = 'Tap again to undo'; return; }
              e.target.disabled = true;
              try { await api('POST', '/api/admin/payroll/unmark', { user_id: r.user_id, week_start: d.week_start }); closeSheet(); toast('Payment mark removed'); showTab(); }
              catch (x) { err(x.message); e.target.disabled = false; }
            };
          });
        } else {
          confirmSheet(`Pay ${r.name}?`, `<div class="card"><div class="kv"><span>Week</span><span>${esc(range(d.week_start, d.week_end))}</span></div><div class="kv"><span>Hours</span><span class="num">${dec(r.hours)}${r.overtime ? ` (${dec(r.overtime)} OT)` : ''}</span></div><div class="kv"><span>Amount</span><span class="num" style="font-weight:800">${money(r.gross)}</span></div></div>
            ${etaInput(defaultEta())}
            <p class="muted small">Tap this only after you've sent the money. ${esc(first)} will get a notification with the amount and the arrival date.</p>`, `Yes, I sent ${money(r.gross)}`, 'ok', async (bd) => {
            const eta = bd.querySelector('#eta').value;
            await api('POST', '/api/admin/payroll/mark', { user_id: r.user_id, week_start: d.week_start, expected_amount: r.gross, eta });
            S.lastEta = eta; toast(`${first} marked paid — arriving ${fmtDay(eta)}`); showTab();
          });
        }
      };
    });
  }

  function defaultEta() {
    if (S.lastEta && S.lastEta >= today()) return S.lastEta;
    let d = addDays(today(), 1);
    while ([0, 6].includes(ymdParts(d).getUTCDay())) d = addDays(d, 1);
    return d;
  }

  async function viewPeople(v) {
    const d = await api('GET', '/api/admin/people');
    const leadName = (id) => (d.leads.find((l) => l.id === id) || {}).name;
    const active = d.people.filter((p) => p.active), off = d.people.filter((p) => !p.active);
    const row = (p) => `<button class="item" data-edit="${p.id}"><span class="avatar">${esc(initials(p.name))}</span><div class="grow"><div class="t">${esc(p.name)}</div><div class="s">${p.role === 'supervisor' ? 'Lead / Supervisor' : 'Tech'}${p.lead_id ? ` · ${esc(leadName(p.lead_id) || '')}` : ''}</div></div><div class="r num" style="font-weight:700">${money(p.hourly_rate)}<span class="muted small">/hr</span></div>${chev}</button>`;
    v.innerHTML = `<div class="row between"><h1>People</h1><button class="icon-btn" id="st" aria-label="Settings">${I.gear}</button></div>
      <button class="btn block" id="add">+ Add a new tech</button>
      <p class="muted small" style="margin:8px 0 0;text-align:center">You'll get a QR code. They scan it and create their own account.</p>
      ${d.invites.length ? `<h2>Waiting to sign up</h2><div class="list">${d.invites.map((i) => `<div class="item"><div class="grow"><div class="t">${esc(i.name)}</div><div class="s">${i.role === 'supervisor' ? 'Lead' : 'Tech'} · ${money(i.hourly_rate)}/hr · link expires ${esc(fmtShort(ymdOf(i.expires_at)))}</div></div><button class="btn ghost sm" data-qr="${esc(i.token_hint)}">QR</button><button class="icon-btn" data-rv="${esc(i.token_hint)}" aria-label="Cancel invite">${I.x}</button></div>`).join('')}</div>` : ''}
      <h2>Active · ${active.length}</h2>${active.length ? `<div class="list">${active.map(row).join('')}</div>` : '<div class="list"><div class="empty">No one has joined yet.</div></div>'}
      ${off.length ? `<h2>Turned off · ${off.length}</h2><div class="list">${off.map(row).join('')}</div>` : ''}`;
    v.querySelector('#add').onclick = () => personForm(null, d.leads);
    v.querySelector('#st').onclick = openSettings;
    v.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => personForm(d.people.find((p) => p.id === Number(b.dataset.edit)), d.leads); });
    v.querySelectorAll('[data-qr]').forEach((b) => { b.onclick = async () => { const r = await api('GET', `/api/admin/invites/${b.dataset.qr}/link`); showLink(`Invite for ${r.name}`, `Have ${esc(r.name.split(' ')[0])} scan this with their phone camera.`, r.url, r.name, r.qr_svg); }; });
    v.querySelectorAll('[data-rv]').forEach((b) => { b.onclick = () => confirmSheet('Cancel this invite?', '<p class="muted">The QR code and link will stop working.</p>', 'Cancel invite', 'danger', async () => { await api('DELETE', `/api/admin/invites/${b.dataset.rv}`, {}); showTab(); }); });
  }
  function personForm(p, leads) {
    const leadOpts = (sel) => `<option value="">— None —</option>${leads.filter((l) => !p || l.id !== p.id).map((l) => `<option value="${l.id}" ${sel === l.id ? 'selected' : ''}>${esc(l.name)}${l.role === 'owner' ? ' (owner)' : ''}</option>`).join('')}`;
    openSheet(p ? p.name : 'Add a new tech', `<form><div class="form-err"></div>
      <label class="f"><span>Name</span><input class="input" name="name" value="${esc(p?.name || '')}" required></label>
      <label class="f"><span>Their pay rate ($ per hour)</span><input class="input" name="hourly_rate" type="number" step="0.01" min="0" inputmode="decimal" placeholder="e.g. 22.50" value="${p ? p.hourly_rate : ''}" required style="font-size:22px;font-weight:700"><div class="hint">Each person can have a different rate. Only you can see it; they see their own. ${p ? 'Changing it updates pay for weeks not yet marked paid.' : 'You can change it later.'}</div></label>
      <label class="f"><span>Role</span><select class="input" name="role"><option value="tech" ${p?.role !== 'supervisor' ? 'selected' : ''}>Tech</option><option value="supervisor" ${p?.role === 'supervisor' ? 'selected' : ''}>Team lead / Supervisor</option></select></label>
      <label class="f"><span>Reports to (team lead)</span><select class="input" name="lead_id">${leadOpts(p?.lead_id)}</select><div class="hint">Their time-off requests go to this person. Leads can approve and fix hours for techs.</div></label>
      ${p ? `<label class="f"><span>Phone</span><input class="input" name="phone" type="tel" value="${esc(p.phone || '')}"></label><label class="f"><span>Email</span><input class="input" name="email" type="email" value="${esc(p.email || '')}"></label>
      <label class="f row" style="gap:10px"><input type="checkbox" name="active" ${p.active ? 'checked' : ''} style="width:20px;height:20px"><span style="margin:0;color:var(--text)">Account active (uncheck when someone leaves)</span></label>` : ''}
      <button class="btn block" type="submit">${p ? 'Save' : 'Create QR invite'}</button>
      ${p ? '<button type="button" class="btn ghost block" id="rs" style="margin-top:10px">Send password reset link</button>' : ''}</form>`, (b) => {
      const f = b.querySelector('form');
      bindForm(f, async (d) => {
        if (p) {
          await api('PUT', `/api/admin/people/${p.id}`, { ...d, lead_id: d.lead_id || null, active: !!f.active.checked });
          closeSheet(); toast('Saved'); showTab();
        } else {
          const r = await api('POST', '/api/admin/invites', { ...d, lead_id: d.lead_id || null });
          showTab();
          showLink(`Invite for ${d.name}`, `<b style="color:var(--text)">${money(d.hourly_rate)}/hr</b> is saved for ${esc(d.name.split(' ')[0])}. Have them scan this with their phone camera, or text them the link. It works for 14 days, one time.`, r.url, d.name, r.qr_svg);
        }
      });
      const rs = b.querySelector('#rs');
      if (rs) rs.onclick = async () => { const r = await api('POST', `/api/admin/people/${p.id}/reset`, {}); showLink(`Reset for ${r.name}`, 'They scan this to set a new password. Works for 2 days, one time.', r.url, r.name, r.qr_svg); };
    });
  }
  async function openSettings() {
    openSheet('Settings', '<div class="spin"></div>');
    const s = await api('GET', '/api/admin/settings');
    const b = $sheet.querySelector('.sheet-body'); if (!b) return;
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekOpts = days.map((d, i) => `<option value="${i}" ${i === s.week_start_day ? 'selected' : ''}>${d} – ${days[(i + 6) % 7]}</option>`).join('');
    const payOpts = `<option value="-1" ${s.payday_weekday < 0 ? 'selected' : ''}>Exactly on that day</option>` + days.map((d, i) => `<option value="${i}" ${i === s.payday_weekday ? 'selected' : ''}>On the next ${d}</option>`).join('');
    b.innerHTML = `<form><div class="form-err"></div>
      <label class="f"><span>Company name</span><input class="input" name="company_name" value="${esc(s.company_name)}"></label>
      <h2>Work week</h2>
      <label class="f"><span>Hours are counted</span><select class="input" name="week_start_day">${weekOpts}</select></label>
      <h2>Payday</h2>
      <label class="f"><span>Paid how many days after the week ends? (net days)</span><input class="input" name="pay_delay_days" id="netd" type="number" min="0" max="90" inputmode="numeric" value="${s.pay_delay_days}"></label>
      <label class="f"><span>Then pay</span><select class="input" name="payday_weekday">${payOpts}</select><div class="hint">“Exactly on that day” pays on day ${s.pay_delay_days || 'N'} even on a weekend. Pick a weekday to always pay on, for example, the next Friday.</div></label>
      <div class="banner" style="margin-top:-4px"><div id="payex" style="font-weight:600"></div></div>
      <h2>Other</h2>
      <label class="f row" style="gap:10px"><input type="checkbox" name="ot_enabled" id="ote" ${s.ot_enabled ? 'checked' : ''} style="width:20px;height:20px"><span style="margin:0;color:var(--text)">Pay overtime</span></label>
      <div class="split" id="otf" ${s.ot_enabled ? '' : 'hidden'}><label class="f"><span>Overtime after (hrs/week)</span><input class="input" name="ot_threshold" type="number" step="0.5" value="${s.ot_threshold}"></label>
      <label class="f"><span>Overtime rate (×)</span><input class="input" name="ot_multiplier" type="number" step="0.1" value="${s.ot_multiplier}"></label></div>
      <label class="f"><span>Max shift length (hours)</span><input class="input" name="max_shift_hours" type="number" min="0" max="24" step="0.25" value="${s.max_shift_hours}"><div class="hint">If someone forgets to clock out, or clocks out late, the shift is cut to this length and their lead is told. 0 = no limit.</div></label>
      <label class="f"><span>Days of notice for time off</span><input class="input" name="timeoff_notice_days" type="number" min="0" max="90" value="${s.timeoff_notice_days}"></label>
      <label class="f"><span>Time zone</span><input class="input" name="timezone" value="${esc(s.timezone)}"><div class="hint">For example America/Chicago, America/New_York</div></label>
      <button class="btn block" type="submit">Save settings</button></form>
      <a class="btn ghost block" style="margin-top:10px" href="/api/admin/backup">Download a backup of all data</a>
      <p class="hint" style="text-align:center">Do this once a week and keep the file somewhere safe.</p>`;
    b.querySelector('#ote').onchange = (e) => { b.querySelector('#otf').hidden = !e.target.checked; };
    const f = b.querySelector('form');
    const example = () => {
      const end = addDays(addDays(today(), -((ymdParts(today()).getUTCDay() - Number(f.week_start_day.value) + 7) % 7)), 6);
      let pd = addDays(end, Math.max(1, Number(f.pay_delay_days.value) || 0));
      const wd = Number(f.payday_weekday.value);
      if (wd >= 0) while (ymdParts(pd).getUTCDay() !== wd) pd = addDays(pd, 1);
      b.querySelector('#payex').textContent = `Example: work week ${fmtShort(addDays(end, -6))} – ${fmtDay(end)} is paid on ${fmtDay(pd)}.`;
      b.querySelector('#netd').closest('form').querySelector('.hint').textContent = `“Exactly on that day” pays on day ${Number(f.pay_delay_days.value) || 0} even on a weekend. Pick a weekday to always pay on, for example, the next Friday.`;
    };
    ['week_start_day', 'payday_weekday', 'pay_delay_days'].forEach((n) => f[n].addEventListener('input', example));
    example();
    bindForm(b.querySelector('form'), async (d) => { d.ot_enabled = b.querySelector('#ote').checked; const r = await api('PUT', '/api/admin/settings', d); S.boot.settings = { ...S.boot.settings, ...r }; S.tz = r.timezone; closeSheet(); toast('Settings saved'); renderShell(); });
  }

  window.VT_REBOOT = () => { document.getElementById('toast').className = ''; S.tab = null; S.payWeek = null; S.apprStatus = 'pending'; closeSheet(); boot(); };
  window.VT_TOAST = toast;
  window.VT_SHEET = openSheet;
  if ('serviceWorker' in navigator && !window.VT_DEMO) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  boot();
})();
