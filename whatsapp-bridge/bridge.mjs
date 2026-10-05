/**
 * MaintenanceOS ⇄ WhatsApp bridge (unofficial, WhatsApp-Web protocol via Baileys).
 *
 * Runs in the cloud (Render free web service) or on a PC — same code:
 *  - The WhatsApp login is stored in the MaintenanceOS database (through the app API),
 *    so restarts / redeploys do NOT require scanning again. Nothing is kept on disk.
 *  - The QR code appears in MaintenanceOS → Settings (and in this program's log).
 *  - Incoming private messages → POST {APP_URL}/api/whatsapp/bridge/inbound
 *  - Replies: GET {APP_URL}/api/whatsapp/bridge/outbox, then POST /ack.
 *    The app wakes the bridge (POST /notify) when it queues a message; otherwise the
 *    bridge polls every few seconds while a chat is active and every 5 min when idle,
 *    so the free database can sleep.
 *
 * Unofficial: not affiliated with WhatsApp; accounts used this way can be banned. Use a spare number.
 */
import fs from "node:fs";
import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  downloadMediaMessage,
  fetchLatestBaileysVersion,
  getContentType,
  isPnUser,
} from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { loadAppAuthState } from "./auth-store.mjs";

// ─── config ───────────────────────────────────────────────────────────────
// Minimal .env loader (for running on a PC; in the cloud use the host's env vars)
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const APP_URL = (process.env.APP_URL || "").replace(/\/$/, "");
const SECRET = process.env.BRIDGE_SECRET || "";
const PORT = process.env.PORT ? Number(process.env.PORT) : null;
const PUBLIC_URL = (process.env.KEEPALIVE_URL || process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");
const IDLE_POLL_MS = Number(process.env.POLL_IDLE_SECONDS || 300) * 1000;
const ACTIVE_POLL_MS = 3000;
const ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const HEARTBEAT_MS = 5 * 60 * 1000;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024; // keep requests under the app host's body limit

if (!APP_URL || !SECRET) {
  console.error("✖ Set APP_URL and BRIDGE_SECRET (env vars, or whatsapp-bridge/.env on a PC).");
  process.exit(1);
}

const logger = pino({ level: "silent" });
const LOGOUT_ONLY = process.argv.includes("--logout");
const headers = { "Content-Type": "application/json", "x-bridge-secret": SECRET };
const ts = () => new Date().toISOString().slice(11, 19);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init = {}) {
  const res = await fetch(`${APP_URL}${path}`, { ...init, headers, signal: AbortSignal.timeout(65_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

// ─── state ──────────────────────────────────────────────────────────────────
let auth = null;
let sock = null;
let connected = false;
let status = { status: "starting" };
let lastActivity = 0;
let unlinking = false;
let generation = 0;

async function report(next) {
  if (next) status = next;
  try {
    const r = await api("/api/whatsapp/bridge/status", { method: "POST", body: JSON.stringify(status) });
    if (r.logoutRequested && connected && !unlinking) {
      console.log(`[${ts()}] Unlink requested from MaintenanceOS`);
      unlinking = true;
      await sock.logout().catch(() => sock.end(undefined));
    }
  } catch (e) {
    console.error(`[${ts()}] ✖ status report: ${e.message}`);
  }
}

const jidKey = (digits) => `mos-jid-${digits}`;

async function phoneFor(msg) {
  const jid = msg.key.remoteJid;
  if (isPnUser(jid)) return jid;
  if (msg.key.remoteJidAlt && isPnUser(msg.key.remoteJidAlt)) return msg.key.remoteJidAlt;
  try {
    const pn = await sock.signalRepository?.lidMapping?.getPNForLID(jid);
    if (pn) return pn;
  } catch {}
  return jid; // the privacy id is still unique per contact
}

async function onMessage(msg) {
  const jid = msg.key.remoteJid;
  if (!jid || msg.key.fromMe) return;
  if (jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid.endsWith("@newsletter")) return;
  const m = msg.message;
  if (!m) return;
  const kind = getContentType(m);

  const payload = {
    from: (await phoneFor(msg)).split("@")[0].split(":")[0],
    messageId: msg.key.id,
    profileName: msg.pushName || undefined,
    timestamp: Number(msg.messageTimestamp) || undefined,
    type: "text",
    text: undefined,
  };

  if (kind === "conversation") payload.text = m.conversation;
  else if (kind === "extendedTextMessage") payload.text = m.extendedTextMessage?.text;
  else if (["imageMessage", "audioMessage", "videoMessage", "documentMessage"].includes(kind)) {
    const part = m[kind];
    payload.type = kind === "imageMessage" ? "image" : kind === "audioMessage" ? "audio" : kind === "videoMessage" ? "video" : "document";
    payload.text = part?.caption || undefined;
    try {
      const buf = await downloadMediaMessage(msg, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      if (buf.length <= MAX_MEDIA_BYTES) {
        payload.media = { base64: buf.toString("base64"), mimeType: (part?.mimetype || "application/octet-stream").split(";")[0], fileName: part?.fileName || undefined };
      } else {
        console.warn(`[${ts()}] media too large (${Math.round(buf.length / 1024)} KB) — forwarding caption only`);
        payload.type = "text";
      }
    } catch (e) {
      console.warn(`[${ts()}] could not download media: ${e.message}`);
      payload.type = "text";
    }
  } else {
    return; // reactions, stickers, protocol messages, …
  }
  if (!payload.text && !payload.media) return;

  lastActivity = Date.now();
  if (auth.store.get(jidKey(payload.from)) !== JSON.stringify(jid)) auth.put(jidKey(payload.from), jid);
  console.log(`[${ts()}] ⬇ ${payload.from}: ${payload.text ?? `[${payload.type}]`}`);
  try {
    await sock.readMessages([msg.key]);
    await sock.sendPresenceUpdate("composing", jid);
    const r = await api("/api/whatsapp/bridge/inbound", { method: "POST", body: JSON.stringify(payload) });
    console.log(`[${ts()}]   → ${r.action}${r.ticketNumber ? ` ${r.ticketNumber}` : ""}`);
  } catch (e) {
    console.error(`[${ts()}] ✖ app error: ${e.message}`);
  } finally {
    sock.sendPresenceUpdate("paused", jid).catch(() => {});
  }
  await pollOutbox();
}

let polling = false;
async function pollOutbox() {
  if (!connected || polling) return;
  polling = true;
  try {
    const { messages } = await api("/api/whatsapp/bridge/outbox");
    if (!messages.length) return;
    lastActivity = Date.now();
    const results = [];
    for (const out of messages) {
      const digits = out.to.replace(/\D/g, "");
      const saved = auth.store.get(jidKey(digits));
      const jid = saved ? JSON.parse(saved) : `${digits}@s.whatsapp.net`;
      try {
        const sent = await sock.sendMessage(jid, { text: out.body });
        results.push({ id: out.id, ok: true, providerMessageId: sent?.key?.id });
        console.log(`[${ts()}] ⬆ ${digits}: ${out.body.split("\n")[0].slice(0, 70)}`);
      } catch (e) {
        results.push({ id: out.id, ok: false, error: e.message });
        console.error(`[${ts()}] ✖ send to ${digits}: ${e.message}`);
      }
    }
    await api("/api/whatsapp/bridge/ack", { method: "POST", body: JSON.stringify({ results }) }).catch((e) => console.error(`ack: ${e.message}`));
  } catch (e) {
    console.error(`[${ts()}] ✖ outbox: ${e.message}`);
  } finally {
    polling = false;
  }
}

// ─── WhatsApp connection ───────────────────────────────────────────────────
async function start() {
  const myGen = ++generation;
  if (!auth) auth = await loadAppAuthState(api, (m) => console.error(`[${ts()}] ${m}`));
  const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
  sock = makeWASocket({ version, auth: auth.state, logger, browser: Browsers.windows("MaintenanceOS"), markOnlineOnConnect: false });
  sock.ev.on("creds.update", auth.saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (myGen !== generation) return;
    if (qr) {
      console.log(`\n[${ts()}] Scan this QR (also shown in MaintenanceOS → Settings) with the bot phone → WhatsApp → Settings → Linked devices → Link a device:\n`);
      qrcode.generate(qr, { small: true });
      report({ status: "qr", qr });
    }
    if (connection === "connecting" && status.status !== "qr") report({ status: "connecting" });
    if (connection === "open") {
      connected = true;
      const phone = sock.user?.id?.split(":")[0]?.split("@")[0];
      console.log(`\n[${ts()}] ✅ WhatsApp linked as +${phone} — forwarding to ${APP_URL}\n`);
      await auth.flush();
      report({ status: "connected", phone });
      pollOutbox();
    }
    if (connection === "close") {
      connected = false;
      const code = lastDisconnect?.error?.output?.statusCode;
      if (code === DisconnectReason.loggedOut || unlinking) {
        console.warn(`[${ts()}] WhatsApp unlinked — clearing the saved login; a new QR will follow`);
        await auth.flush().catch(() => {});
        await api("/api/whatsapp/bridge/auth", { method: "POST", body: JSON.stringify({ clear: true }) }).catch((e) => console.error(`clear: ${e.message}`));
        auth = null;
        unlinking = false;
        status = { status: "logged_out" };
        setTimeout(start, 2000);
        return;
      }
      console.warn(`[${ts()}] connection closed (${code ?? "?"}) — reconnecting…`);
      if (status.status !== "qr") report({ status: "connecting", error: `connection closed (${code ?? "?"})` });
      setTimeout(start, code === DisconnectReason.restartRequired ? 500 : 3000);
    }
  });
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;
    for (const msg of messages) await onMessage(msg).catch((e) => console.error(e));
  });
}

// ─── HTTP (cloud host health check + wake-up from the app) ─────────────────────
function secretOk(req) {
  const got = Buffer.from(String(req.headers["x-bridge-secret"] || ""));
  const want = Buffer.from(SECRET);
  return got.length === want.length && timingSafeEqual(got, want);
}

if (PORT && !LOGOUT_ONLY) {
  http
    .createServer((req, res) => {
      const url = req.url || "/";
      if (url.startsWith("/notify") && req.method === "POST") {
        if (!secretOk(req)) {
          res.writeHead(401).end();
          return;
        }
        lastActivity = Date.now();
        res.writeHead(202, { "Content-Type": "application/json" }).end('{"ok":true}');
        report().then(pollOutbox);
        return;
      }
      if (url.startsWith("/healthz")) {
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true, whatsapp: status.status }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end(`MaintenanceOS WhatsApp bridge — ${status.status}. Scan the QR in MaintenanceOS → Settings.`);
    })
    .listen(PORT, () => console.log(`HTTP on :${PORT}${PUBLIC_URL ? ` (${PUBLIC_URL})` : ""}`));
}

// Free hosts sleep after ~15 min without HTTP traffic — ping our own public URL.
// (Only touches this service, not the database, so the database can still sleep.)
if (PUBLIC_URL && !LOGOUT_ONLY) setInterval(() => fetch(`${PUBLIC_URL}/healthz`).catch(() => {}), 10 * 60 * 1000);

// Poll fast while a conversation is active, slowly when idle.
(async function pollLoop() {
  while (!LOGOUT_ONLY) {
    const active = Date.now() - lastActivity < ACTIVE_WINDOW_MS;
    await sleep(active ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    await pollOutbox();
  }
})();
setInterval(() => {
  if (status.status === "connected") report();
}, HEARTBEAT_MS);

async function shutdown(sig) {
  console.log(`[${ts()}] ${sig} — saving login and stopping`);
  try {
    if (auth) await auth.flush();
  } finally {
    process.exit(0);
  }
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

if (LOGOUT_ONLY) {
  // `npm run logout`: forget the saved login (the phone may still list the device — remove it there too)
  await api("/api/whatsapp/bridge/auth", { method: "POST", body: JSON.stringify({ clear: true }) });
  console.log("Saved WhatsApp login cleared — the next start shows a new QR.");
  process.exit(0);
}

console.log(`MaintenanceOS WhatsApp bridge → ${APP_URL}`);
api("/api/health")
  .then((h) => console.log(`App reachable · database ${h.database} · AI ${h.providers?.ai} · WhatsApp provider ${h.providers?.whatsapp}`))
  .catch((e) => console.warn(`⚠ Could not reach ${APP_URL}/api/health: ${e.message}`));
report({ status: "starting" }).then(() => start());
