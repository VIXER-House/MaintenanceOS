"use client";

import { useEffect, useState } from "react";
import { Loader2, QrCode, Smartphone, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/api-client";

interface BridgeLink {
  status: string;
  online: boolean;
  qrDataUrl: string | null;
  phone: string | null;
  lastSeenAt: string | null;
  error: string | null;
  logoutRequested: boolean;
}

const BRIDGE_STATUS: Record<string, { label: string; tone: string }> = {
  connected: { label: "Connected", tone: "bg-emerald-100 text-emerald-800" },
  qr: { label: "Waiting for QR scan", tone: "bg-amber-100 text-amber-800" },
  connecting: { label: "Connecting…", tone: "bg-sky-100 text-sky-800" },
  starting: { label: "Starting…", tone: "bg-sky-100 text-sky-800" },
  logged_out: { label: "Unlinked", tone: "bg-slate-100 text-slate-700" },
  error: { label: "Error", tone: "bg-red-100 text-red-800" },
  offline: { label: "Bridge offline", tone: "bg-red-100 text-red-800" },
  never_connected: { label: "Bridge never started", tone: "bg-slate-100 text-slate-700" },
};

/** Live link status of the WhatsApp QR bridge — scan the QR right here from the dashboard. */
export function BridgeLinkCard() {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const [s, setS] = useState<BridgeLink | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => api<BridgeLink>("/api/settings/whatsapp-link").then((r) => alive && setS(r)).catch(() => {});
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  const st = BRIDGE_STATUS[s?.status ?? "starting"] ?? BRIDGE_STATUS.starting;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><QrCode className="h-4 w-4" /> WhatsApp (QR link)</CardTitle>
        <CardDescription>The bridge service keeps a spare WhatsApp number linked to MaintenanceOS. Use a spare number — this is an unofficial connection.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!s ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.tone}`}>{st.label}</span>
              {s.phone && s.status === "connected" && (
                <span className="flex items-center gap-1 text-muted-foreground" dir="ltr"><Smartphone className="h-3.5 w-3.5" /> +{s.phone}</span>
              )}
              {s.lastSeenAt && <span className="text-xs text-muted-foreground">last heartbeat {new Date(s.lastSeenAt).toLocaleTimeString()}</span>}
            </div>
            {s.qrDataUrl && (
              <div className="space-y-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={s.qrDataUrl} alt="WhatsApp QR code" className="h-56 w-56 rounded-md border bg-white p-1" />
                <p className="text-xs text-muted-foreground">On the bot phone: WhatsApp → Settings → Linked devices → Link a device, then scan. The code refreshes every ~20 s.</p>
              </div>
            )}
            {(s.status === "offline" || s.status === "never_connected") && (
              <p className="text-xs text-muted-foreground">
                Start the bridge service (Render) with APP_URL = <span className="font-mono" dir="ltr">{origin}</span> and the same BRIDGE_SECRET as WHATSAPP_BRIDGE_SECRET here. A Render free instance can take ~1 minute to wake up.
              </p>
            )}
            {s.error && <div className="break-words rounded bg-red-50 p-2 font-mono text-xs text-red-700">{s.error}</div>}
            {s.status === "connected" && (
              <Button
                variant="outline"
                size="sm"
                disabled={busy || s.logoutRequested}
                onClick={async () => {
                  if (!window.confirm("Unlink this WhatsApp number? A new QR code will appear.")) return;
                  setBusy(true);
                  try {
                    await api("/api/settings/whatsapp-link", { body: { action: "unlink" } });
                    toast.success("Unlinking — a new QR will appear shortly");
                  } catch (e) {
                    toast.error((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <Unlink /> {s.logoutRequested ? "Unlinking…" : "Unlink number"}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
