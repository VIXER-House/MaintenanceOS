import { requirePageUser, MANAGERS } from "@/lib/auth";
import { getDashboard } from "@/server/services/dashboard.service";
import { DashboardView } from "@/features/dashboard/dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requirePageUser(MANAGERS);
  const data = await getDashboard();
  return <DashboardView data={data} />;
}
