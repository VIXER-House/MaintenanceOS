import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { isImportType } from "@/lib/import/core";
import { PageHeader } from "@/components/domain/page-header";
import { ImportWizard } from "@/features/import/import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const { type } = await searchParams;
  const compounds = await db.compound.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, name: true, nameAr: true } });
  return (
    <div>
      <PageHeader title={t.residentsImport.pageTitle} subtitle={t.residentsImport.pageSubtitle} />
      <ImportWizard
        initialType={isImportType(type) ? type : "residents"}
        compounds={compounds.map((c) => ({ id: c.id, name: locale === "ar" ? c.nameAr ?? c.name : c.name }))}
      />
    </div>
  );
}
