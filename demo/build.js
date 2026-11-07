// Builds demo/index.html: the real app front end + an in-browser demo backend, in one file.
// Run: node demo/build.js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const server = read('server.js');
const tz = server.slice(server.indexOf('/* ---------------- time zone helpers'), server.indexOf('/* ---------------- pay math'));
const mock = read('demo/mock.js').replace('/*@@TZ_HELPERS@@*/', tz);
const qr = read('qr.js')
  .replace("'use strict';", '')
  .replace("[...Buffer.from(String(text), 'utf8')]", '[...new TextEncoder().encode(String(text))]')
  .replace('module.exports = { toSvg, encode };', 'window.VTQR = { toSvg, encode };');
const css = read('public/styles.css');
const app = read('public/app.js');

const demoCss = `
.demo-bar { position: fixed; top: 0; left: 0; right: 0; z-index: 40; height: 48px; background: #fff; color: #000; padding-top: env(safe-area-inset-top, 0px); box-sizing: content-box; }
.demo-in { max-width: 560px; margin: 0 auto; height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 12px; }
.demo-tag { background: #000; color: #fff; font-weight: 800; font-size: 11px; letter-spacing: .12em; padding: 4px 8px; border-radius: 6px; flex-shrink: 0; }
.demo-in label { font-size: 12px; font-weight: 600; color: #555; flex-shrink: 0; }
.demo-in select { flex: 1; min-width: 0; font: inherit; font-size: 14px; font-weight: 700; color: #000; background: #f1f1f1; border: 0; border-radius: 8px; padding: 7px 8px; }
.demo-in button { font: inherit; font-size: 12px; font-weight: 700; border: 1px solid #ccc; background: #fff; color: #000; border-radius: 8px; padding: 7px 9px; cursor: pointer; flex-shrink: 0; }
.demo-in button.hot { background: #000; color: #fff; border-color: #000; }
body.demo .topbar { top: calc(48px + env(safe-area-inset-top, 0px)); padding-top: 0; }
body.demo .shell { padding-top: calc(env(safe-area-inset-top, 0px) + 112px); }
body.demo .auth { padding-top: calc(env(safe-area-inset-top, 0px) + 96px); }
@media (max-width: 380px) { .demo-in label { display: none; } }
`;

const bar = `
(() => {
  const sel = document.getElementById('demo-who');
  const inv = document.getElementById('demo-inv');
  const rst = document.getElementById('demo-reset');
  const order = { owner: 0, supervisor: 1, tech: 2 }, roleTag = { owner: 'Owner', supervisor: 'Lead', tech: 'Tech' };
  const clean = (t) => String(t).replace(/[<>&"]/g, '');
  function fill() {
    const cur = window.VT_DEMO.current();
    const us = window.VT_DEMO.users().sort((a, b) => (order[a.role] - order[b.role]) || a.name.localeCompare(b.name));
    const html = (cur ? '' : '<option value="">Signed out</option>') + us.map((u) => '<option value="' + u.id + '"' + (u.id === cur ? ' selected' : '') + '>' + clean(u.name) + ' — ' + roleTag[u.role] + '</option>').join('');
    if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; }
    inv.hidden = !window.VT_DEMO.lastInvite();
  }
  sel.onchange = () => { if (!sel.value) return; window.VT_JOIN = null; window.VT_DEMO.switchTo(sel.value); window.VT_REBOOT(); fill(); };
  let armed = null;
  rst.onclick = () => {
    if (!armed) { rst.textContent = 'Tap again'; rst.classList.add('hot'); armed = setTimeout(() => { armed = null; rst.textContent = 'Reset'; rst.classList.remove('hot'); }, 3000); return; }
    clearTimeout(armed); armed = null; rst.textContent = 'Reset'; rst.classList.remove('hot');
    window.VT_DEMO.reset(); window.VT_JOIN = null; window.VT_REBOOT(); fill(); window.VT_TOAST('Demo reset to the sample crew');
  };
  inv.onclick = () => { const t = window.VT_DEMO.lastInvite(); if (!t) return; window.VT_JOIN = t; window.VT_REBOOT(); };
  setInterval(fill, 800); fill();
  const sites = [[41.8781, -87.6298], [41.9742, -87.9073], [41.7508, -87.7124], [42.0451, -87.6877]];
  window.VT_FAKE_LOCATION = () => { const s = sites[Math.floor(Math.random() * sites.length)]; return { lat: s[0] + Math.random() * 0.003, lng: s[1] + Math.random() * 0.003, acc: 10 }; };
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="/api/"]');
    if (!a) return;
    e.preventDefault();
    if (a.getAttribute('href').startsWith('/api/admin/payroll.csv')) {
      const week = new URLSearchParams(a.getAttribute('href').split('?')[1] || '').get('week');
      const f = window.VT_DEMO.csv(week);
      window.VT_SHEET(f.name, '<p class="muted" style="margin-top:0">In the real app this downloads as a spreadsheet you can open in Excel. Here is what is inside:</p><pre id="csvp" style="background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px;font-size:12px;overflow-x:auto;white-space:pre;user-select:all">' + f.text.replace(/[<&]/g, (c) => c === '<' ? '&lt;' : '&amp;') + '</pre><button class="btn ghost block" id="csvc">Copy</button>', (b) => {
        b.querySelector('#csvc').onclick = () => { navigator.clipboard.writeText(f.text).then(() => window.VT_TOAST('Copied'), () => { const r = document.createRange(); r.selectNodeContents(b.querySelector('#csvp')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); window.VT_TOAST('Selected — copy it'); }); };
      });
    } else window.VT_TOAST('In the real app this downloads a backup file');
  }, true);
})();`;

const html = `<title>VayTech Time Demo</title>
<meta name="theme-color" content="#000000">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
${css}
${demoCss}
body { background: var(--bg); }
</style>
<div class="demo-bar"><div class="demo-in">
  <span class="demo-tag">DEMO</span>
  <label for="demo-who">View as</label>
  <select id="demo-who" aria-label="View the app as"></select>
  <button id="demo-inv" class="hot" hidden title="Open the invite you just created, as the new person">Sign up ›</button>
  <button id="demo-reset">Reset</button>
</div></div>
<div id="app"><div class="boot"><div class="logo-mark">V</div></div></div>
<div id="sheet-root"></div>
<div id="toast" role="status" aria-live="polite"></div>
<script>document.body.classList.add('demo');</script>
<script>
${qr}
</script>
<script>
${mock}
</script>
<script>
${app}
</script>
<script>
${bar}
</script>
`;
fs.writeFileSync(path.join(__dirname, 'index.html'), html);
console.log('demo/index.html', Math.round(html.length / 1024) + ' KB');
