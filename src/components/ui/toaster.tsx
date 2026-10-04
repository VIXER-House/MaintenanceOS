"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Toast = { id: number; kind: "success" | "error" | "info"; message: string };

/** Minimal toast system: call toast.success("...") from anywhere on the client. */
export const toast = {
  success: (message: string) => emit({ kind: "success", message }),
  error: (message: string) => emit({ kind: "error", message }),
  info: (message: string) => emit({ kind: "info", message }),
};
function emit(t: Omit<Toast, "id">) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("mos-toast", { detail: t }));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    let n = 0;
    const handler = (e: Event) => {
      const t = { ...(e as CustomEvent).detail, id: ++n } as Toast;
      setItems((xs) => [...xs, t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), 4500);
    };
    window.addEventListener("mos-toast", handler);
    return () => window.removeEventListener("mos-toast", handler);
  }, []);
  return (
    <div className="pointer-events-none fixed bottom-4 end-4 z-[100] flex w-[360px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex animate-fade-in items-start gap-2 rounded-lg border bg-card p-3 text-sm shadow-lg",
            t.kind === "error" && "border-red-200",
          )}
        >
          {t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 text-red-600" /> : <Info className="mt-0.5 h-4 w-4 text-sky-600" />}
          <span className="flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}
