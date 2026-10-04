import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { NewTicketForm } from "@/features/tickets/new-ticket-form";

export default async function NewTicketPage() {
  await requirePageUser(MANAGERS);
  const [residents, categories] = await Promise.all([
    db.resident.findMany({ where: { unitId: { not: null } }, include: { unit: true }, orderBy: { unit: { code: "asc" } } }),
    db.category.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <NewTicketForm
      residents={residents.map((r) => ({ id: r.id, name: r.name, nameAr: r.nameAr, unit: r.unit!.code }))}
      categories={categories.map((c) => ({ key: c.key, nameEn: c.nameEn, nameAr: c.nameAr }))}
    />
  );
}
