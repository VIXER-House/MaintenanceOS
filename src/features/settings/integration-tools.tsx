"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, QrCode, Smartphone, Sparkles, Unlink, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/api-client";

interface ClassifyResult {
  provider: string;
  model: string | null;
  latencyMs: number;
  fallbackUsed: boolean;
  error: string | null;
  classification: { category: string; priority: string; issue: string; issueAr: string | null; location: string | null; confidence: number; reasoning: string; followUpQuestion: string | null };
  priorityDecision: { priority: string; reasons: string[] };
}

/** Runs one real classification through the configured AI provider (no ticket is created). */
export function AiTestCard() {
  const [text, setText] = useState("المياه بتسرب من سقف الحمام وبتغرق الأرض");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<ClassifyResult | null>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-600" /> Test AI</CardTitle>
        <CardDescription>Sends one message to the configured AI provider. No ticket is created.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} dir="auto" />
        <Button
          disabled={busy || !text.trim()}
          onClick={async () => {
            setBusy(true);
            try {
              setRes(await api<ClassifyResult>("/api/ai/classify", { body: { text } }));
            } catch (e) {
              toast.error((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} Classify
        </Button>
        {res && (
          <div className="space-y-1.5 rounded-md border p-3 text-sm">
            <div className={`flex items-center gap-1.5 font-medium ${res.fallbackUsed || res.provider === "mock" ? "text-orange-700" : "text-emerald-700"}`}>
              {res.fallbackUsed || res.provider === "mock" ? <XCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {res.fallbackUsed
                ? `Real AI failed — used local fallback`
                : res.provider === "mock"
                  ? "Using the local mock AI (no AI_PROVIDER key configured)"
                  : `Real AI working: ${res.provider} · ${res.model} · ${res.latencyMs}ms`}
            </div>
            {res.error && <div className="break-words rounded bg-red-50 p-2 font-mono text-xs text-red-700">{res.error}</div>}
            <div className="text-xs text-muted-foreground">
              {res.classification.category} · {res.classification.issue}
              {res.classification.issueAr ? ` (${res.classification.issueAr})` : ""} · {res.classification.location ?? "—"} · AI priority {res.classification.priority} → final{" "}
              {res.priorityDecision.priority} · {Math.round(res.classification.confidence * 100)}%
            </div>
            {res.classification.followUpQuestion && <div className="text-xs" dir="auto">❓ {res.classification.followUpQuestion}</div>}
            {res.classification.reasoning && <div className="text-xs text-muted-foreground">{res.classification.reasoning}</div>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Values to paste into Meta's WhatsApp webhook configuration. */
export function WebhookInfoCard({ verifyToken, provider }: { verifyToken: string; provider: string }) {
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  const twilio = provider === "twilio";
  if (provider === "bridge") return <BridgeLinkCard origin={origin} />;
  const url = `${origin}/api/whatsapp/${twilio ? "twilio" : "webhook"}`;
  const copy = (v: string) => navigator.clipboard.writeText(v).then(() => toast.success("Copied"));
  const rows = twilio ? [["“When a message comes in” URL (method POST)", url]] : [["Callback URL", url], ["Verify token", verifyToken]];
  return (
    <Card>
      <CardHeader>
        <CardTitle>WhatsApp webhook ({twilio ? "Twilio Sandbox" : "Meta"})</CardTitle>
        <CardDescription>
          {twilio ? (
            <>Paste into Twilio Console → Messaging → Try it out → Send a WhatsApp message → <b>Sandbox settings</b>.</>
          ) : (
            <>Paste these into Meta → WhatsApp → Configuration → Webhook, then subscribe to <b>messages</b>.</>
          )}{" "}
          Current provider: <b>{provider}</b>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.map(([k, v]) => (
          <div key={k}>
            <div className="mb-1 text-xs text-muted-foreground">{k}</div>
            <div className="flex gap-2">
              <Input readOnly value={v} dir="ltr" className="font-mono text-xs" />
              <Button variant="outline" size="icon" onClick={() => copy(v)}><Copy /></Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

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
export function BridgeLinkCard({ origin }: { origin: string }) {
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
