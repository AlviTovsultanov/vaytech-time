# VayTech Time

A phone app for the VayTech crew: clock in and out, see this week's hours and pay, see when the deposit lands, and request time off or sick leave.

It runs as a web app that each person adds to their phone's home screen, where it opens full screen like a regular app. Nothing has to go through the App Store or Google Play.

## What each person can do

**Techs**
- Clock in and clock out with one big button. If they forget to clock out, the shift ends on its own at 12 hours. Their location is saved each time, but they can still clock in from anywhere.
- See hours this week, estimated gross pay (hours × their own rate), and the deposit date.
- See past weeks, each marked **Sent** with a date or **Pays Fri, …**.
- Request a day off. It must be at least 14 days ahead, and the app blocks anything sooner.
- Call in sick, including the same day.
- Send a **Fix my hours** request when they forget to clock in or out.
- Get notified when a request is approved or denied, when a lead changes their hours, and when their pay is sent.

**Team leads / supervisors**
- See who is on the clock right now and where they clocked in (Map link).
- Choose between **My crew** and **Everyone**.
- Add, edit or remove a tech's shifts remotely. A reason is required, and the tech is notified.
- Approve or deny time off, sick leave and hour fixes, with an optional note.
- Clock in themselves, see their own pay, and request time off (their requests go to the owner).
- Leads **cannot** see anyone's pay rate or edit their own hours.

**Owner (you)**
- **Payroll:** every person's hours, rate and gross pay for the week. Once you've sent someone's money, tap the box next to their name. They get a notification: *"Your pay of $X … has been sent. You will receive it shortly."*
  - The box can't be checked twice, so nobody gets paid twice.
  - If hours change after you've paid, that person is flagged in yellow with the difference.
  - You can't mark someone paid while they're still clocked in.
  - **Download spreadsheet (CSV)** gives you the week for your records or your accountant.
- **People:** tap **+ Add a new tech**, enter their name, **their own hourly rate** and their lead, and you get a **QR code**. Each person can have a different rate. They scan it with their phone camera and create their own account (phone number + password). The link works once and expires in 14 days.
  - You can also copy the link or text it.
  - Edit rates, leads and roles. Turn off an account when someone leaves, which signs them out right away.
  - **Send password reset link** gives a QR code to someone who forgot their password.
- **Team / Requests:** everything leads can do, for everyone.
- **Settings** (gear icon on People): week start, payday, overtime rules, notice days, time zone, and **Download a backup**.

### Defaults (change them in Settings)
| Setting | Default |
|---|---|
| Work week | Monday – Sunday |
| Overtime | **Off.** Every hour is paid at the person's own rate (turn on in Settings if ever needed) |
| Payday | Friday after the week ends (week of Nov 2–8 → paid Fri Nov 13) |
| Time-off notice | 14 days |
| Max shift length | 12 hours. A shift with no clock-out, or one clocked out late, is cut to exactly 12:00 and the tech and their lead are notified |
| Time zone | America/Chicago |

Pay shown is **gross (before taxes)**.

---

## Putting it online

You need a server that runs Node.js 22 or newer and has a **persistent disk** (the database is one file). The app has **no dependencies**, so there is nothing to install.

### Option A: Render.com (easiest)
1. Put this folder in a private GitHub repository.
2. On Render: **New → Web Service** → pick the repo.
   - Runtime: **Node**
   - Build command: *(leave empty)*
   - Start command: `npm start`
   - Instance type: a paid one (free instances can't have disks).
3. **Disks → Add disk**: mount path `/data`, 1 GB is plenty.
4. **Environment**: add `DATA_DIR=/data` and `PUBLIC_URL=https://<your-render-url>` (or your own domain later).
5. Deploy, then open the URL. The first screen asks you to **create the owner account**. That's you.

### Option B: Railway, Fly.io or your own server (Docker)
```
docker build -t vaytech-time .
docker run -d -p 3000:3000 -v vaytech-data:/data -e PUBLIC_URL=https://time.vaytech.org vaytech-time
```
Put it behind HTTPS (Caddy, nginx, Cloudflare, or the host's built-in HTTPS). **HTTPS is required** for phone location and the home-screen app.

### Using your own address (e.g. time.vaytech.org)
At your domain provider, add a CNAME record `time` → your Render/Railway address, add the custom domain in the host's dashboard, and set `PUBLIC_URL=https://time.vaytech.org`. Do this **before** sending invites, because the QR codes contain the address.

### Backups
Settings → **Download a backup of all data** once a week. That one file holds everything. To restore, stop the app, put the file at `/data/vaytech.db`, and start it again.

---

## Getting the crew on it
1. Add your team leads first (role **Team lead / Supervisor**), then the techs, picking each tech's lead.
2. Show them the QR code or text them the link. They create an account with their phone number.
3. Tell them to add it to the home screen:
   - **iPhone:** open in Safari → Share → **Add to Home Screen**
   - **Android:** open in Chrome → ⋮ → **Add to Home screen / Install app**
4. When they first clock in, the phone asks to share location. Tell them to tap **Allow**.

## Good to know
- **Notifications** show up in the app (bell icon with a red count) and update every 30 seconds while it's open. They don't buzz the phone when the app is closed. Phone push alerts can be added next. They need a little extra setup on the server and work on iPhone only after the app is added to the home screen.
- People sign in with their **phone number** (any format) or email, plus a password.
- Every change a lead makes to someone's hours is logged with who, when and why (visible on the person's page).
- Passwords are stored encrypted (scrypt). Sessions last 60 days. Sign-in attempts are rate-limited.

## For a developer
- `server.js`: HTTP API + SQLite (Node's built-in `node:sqlite`), no npm packages
- `qr.js`: built-in QR code generator (SVG)
- `public/`: the app (plain HTML/CSS/JS, no build step), service worker, manifest, icons
- `npm test`: end-to-end test of the whole flow (invites, clock, edits, per-person rates, overtime on/off, double-pay guard, 14-day rule, approvals, notifications)
