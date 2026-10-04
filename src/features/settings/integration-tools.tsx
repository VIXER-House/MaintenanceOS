"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Copy, Loader2, Sparkles, XCircle } from "lucide-react";
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
