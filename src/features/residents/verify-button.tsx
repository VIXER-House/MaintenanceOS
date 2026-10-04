"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toaster";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n/client";

export function VerifyResidentButton({ residentId }: { residentId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size="sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await api(`/api/residents/${residentId}/verify`, { method: "POST" });
          toast.success(t.residents.verified);
          router.refresh();
        } catch (e) {
          toast.error((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="animate-spin" /> : <BadgeCheck />} {t.residents.verify}
    </Button>
  );
}
