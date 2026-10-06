import { notFound } from "next/navigation";
import { requirePageUser, STAFF } from "@/lib/auth";
import { db } from "@/lib/db";
import { getTicketDetail } from "@/server/services/query.service";
import { TicketDetailView } from "@/features/tickets/ticket-detail";

export const dynamic = "force-dynamic";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser([...STAFF, "RESIDENT"]);
  const { id } = await params;
  const ticket = await getTicketDetail(id, user);
  if (!ticket) notFound();
  const [categories, assets] = await Promise.all([
    db.category.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { key: true, nameEn: true, nameAr: true } }),
    db.asset.findMany({ orderBy: { assetCode: "asc" }, select: { id: true, assetCode: true, name: true } }),
  ]);
  return <TicketDetailView ticket={ticket} role={user.role} categories={categories} assets={assets} />;
}
