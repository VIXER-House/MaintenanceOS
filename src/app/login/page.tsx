import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser, homeFor } from "@/lib/auth";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(homeFor(user.role));
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
