import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { OPEN_STATUSES } from "@/server/domain/constants";
import { WhatsAppSimulator } from "@/features/whatsapp/simulator";

export const dynamic = "force-dynamic";

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<{ resident?: string }> }) {
  await requirePageUser(MANAGERS);
  const sp = await searchParams;
  const residents = await db.resident.findMany({
    include: {
      unit: true,
      _count: { select: { tickets: { where: { status: { in: OPEN_STATUSES } } } } },
      conversations: { select: { lastMessageAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true } } } },
    },
    orderBy: { unit: { code: "asc" } },
  });
  return (
    <WhatsAppSimulator
      initialResidentId={sp.resident ?? residents[0]?.id}
      residents={residents.map((r) => ({
        id: r.id,
        name: r.name,
        nameAr: r.nameAr,
        phone: r.phone,
        unit: r.unit?.code ?? "—",
        verified: r.verified,
        language: r.language,
        openTickets: r._count.tickets,
        lastMessage: r.conversations[0]?.messages[0]?.body ?? null,
      }))}
    />
  );
}
