import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { ensureDatabaseReady } from "@/server/services/bootstrap.service";

export const maxDuration = 60;

export default async function LoginPage() {
  // First visit on a fresh hosted database creates the schema and demo data
  await ensureDatabaseReady().catch((e) => console.error("[bootstrap] failed", e));
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
