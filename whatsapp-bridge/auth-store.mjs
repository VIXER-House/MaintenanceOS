import { BufferJSON, initAuthCreds, proto } from "baileys";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Baileys auth state stored in the MaintenanceOS database through the app API
 * (GET/POST /api/whatsapp/bridge/auth), so the bridge needs no persistent disk.
 * Everything is cached in memory; changes are written back in small batches.
 *
 * @param {(path: string, init?: RequestInit) => Promise<any>} api  authenticated app client
 * @param {(msg: string) => void} log
 */
export async function loadAppAuthState(api, log = console.error) {
  let entries = {};
  for (let attempt = 1; ; attempt++) {
    try {
      ({ entries } = await api("/api/whatsapp/bridge/auth"));
      break;
    } catch (e) {
      log(`✖ could not load the WhatsApp login from the app (${e.message}) — retry ${attempt}`);
      await sleep(Math.min(30_000, 2000 * attempt));
    }
  }
  const store = new Map(Object.entries(entries));
  const pending = new Map();
  const parse = (s) => JSON.parse(s, BufferJSON.reviver);
  const creds = store.has("creds") ? parse(store.get("creds")) : initAuthCreds();
  let timer = null;
  let chain = Promise.resolve();

  const put = (key, value) => {
    const str = value == null ? null : JSON.stringify(value, BufferJSON.replacer);
    if (str === null) store.delete(key);
    else store.set(key, str);
    pending.set(key, str);
    if (!timer) timer = setTimeout(() => flush(), 400);
  };

  const flush = () => {
    clearTimeout(timer);
    timer = null;
    chain = chain.then(async () => {
      if (!pending.size) return;
      const batch = Object.fromEntries(pending);
      pending.clear();
      try {
        await api("/api/whatsapp/bridge/auth", { method: "POST", body: JSON.stringify({ set: batch }) });
      } catch (e) {
        log(`✖ saving login keys failed (${e.message}) — will retry`);
        for (const [k, v] of Object.entries(batch)) if (!pending.has(k)) pending.set(k, v);
        if (!timer) timer = setTimeout(() => flush(), 5000);
      }
    });
    return chain;
  };

  return {
    isNew: !store.has("creds"),
    store,
    put,
    flush,
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          for (const id of ids) {
            const raw = store.get(`${type}-${id}`);
            if (!raw) continue;
            let value = parse(raw);
            if (type === "app-state-sync-key" && value) value = proto.Message.AppStateSyncKeyData.fromObject(value);
            out[id] = value;
          }
          return out;
        },
        set: async (data) => {
          for (const type of Object.keys(data)) for (const id of Object.keys(data[type])) put(`${type}-${id}`, data[type][id]);
        },
      },
    },
    saveCreds: () => put("creds", creds),
  };
}
