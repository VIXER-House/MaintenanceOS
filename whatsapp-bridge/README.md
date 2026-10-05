# MaintenanceOS WhatsApp bridge (QR code)

Links a normal WhatsApp account to MaintenanceOS by QR code (like WhatsApp Web) —
no Meta business account needed. Runs 24/7 on a free cloud host (Render) or on a PC.

> ⚠ Unofficial (WhatsApp-Web protocol). Use a **spare number**, not your personal one —
> WhatsApp can ban numbers used for automation.

The WhatsApp login is saved in the MaintenanceOS database, so the bridge keeps no files:
restarts and redeploys reconnect without scanning again. The QR code is shown in
**MaintenanceOS → Settings → WhatsApp (QR link)**.

## Production (Render free web service)
1. **Vercel** → Settings → Environment Variables:
   - `WHATSAPP_PROVIDER` = `bridge`
   - `WHATSAPP_BRIDGE_SECRET` = a long random text
   - `WHATSAPP_BRIDGE_URL` = your Render URL (add after step 2, e.g. `https://mos-whatsapp-bridge.onrender.com`)
   Redeploy.
2. **Render** → New → **Web Service** → connect the GitHub repo:
   - Root Directory: `whatsapp-bridge`
   - Runtime: Node · Build: `npm ci` · Start: `npm start` · Instance type: **Free**
   - Environment: `APP_URL` = your Vercel URL, `BRIDGE_SECRET` = same text as `WHATSAPP_BRIDGE_SECRET`,
     `NODE_VERSION` = `22`
   - Health check path (Advanced): `/healthz`
3. Open MaintenanceOS → **Settings**. When the QR appears, on the **bot phone**:
   WhatsApp → Settings → Linked devices → Link a device → scan it.
4. From any other phone, WhatsApp the bot number: `A02-102 الحنفية في المطبخ بتسرب`.

The bridge pings its own Render URL every 10 minutes so the free instance doesn't sleep,
and polls the app slowly when idle so the free Neon database can sleep. The app wakes the
bridge (`WHATSAPP_BRIDGE_URL`) whenever it has a message to send, so replies are instant.

Unlink: **Settings → Unlink number** (a new QR appears), or `npm run logout`.

## On a PC instead
Copy `.env.example` to `.env`, fill `APP_URL` and `BRIDGE_SECRET`, then `npm install` and
`npm start`. The QR prints in the terminal and in Settings. Keep the window open.
