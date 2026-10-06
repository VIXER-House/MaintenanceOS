import { requirePageUser, MANAGERS } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDictionary } from "@/lib/i18n/server";
import { STAFF_ROLES } from "@/server/services/manage.service";
import { PageHeader } from "@/components/domain/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { EntityFormButton, ListControls, RowActions } from "@/features/manage/entity-ui";
import { userFields } from "@/lib/manage/fields";
import { formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const me = await requirePageUser(MANAGERS);
  const { t, locale } = await getDictionary();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const users = await db.user.findMany({
    where: {
      role: { in: [...STAFF_ROLES] },
      ...(sp.archived === "1" ? {} : { isActive: true }),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }, { nameAr: { contains: q, mode: "insensitive" } }] } : {}),
    },
    orderBy: [{ isActive: "desc" }, { role: "asc" }, { name: "asc" }],
  });
  const isAdmin = me.role === "ADMIN";
  const fields = userFields(t, isAdmin);
  return (
    <div>
      <PageHeader
        title={t.manage.users}
        subtitle={t.manage.usersSubtitle}
        actions={<EntityFormButton entity="users" fields={fields} title={`${t.manage.add} · ${t.manage.users}`} defaults={{ role: "MAINTENANCE_MANAGER", locale: "ar" }} />}
      />
      <ListControls />
      <Card>
        <Table>
          <THead><TR><TH>{t.manage.f.name}</TH><TH>{t.manage.f.email}</TH><TH>{t.manage.f.role}</TH><TH>{t.manage.f.phone}</TH><TH /><TH /></TR></THead>
          <TBody>
            {users.map((u) => {
              const locked = u.role === "ADMIN" && !isAdmin;
              return (
                <TR key={u.id} className={u.isActive ? "" : "opacity-60"}>
                  <TD>
                    <div className="flex items-center gap-2 font-medium">
                      {locale === "ar" ? u.nameAr ?? u.name : u.name}
                      {u.id === me.id && <Badge variant="muted">you</Badge>}
                      {!u.isActive && <Badge variant="outline">{t.manage.inactive}</Badge>}
                    </div>
                  </TD>
                  <TD className="text-xs" dir="ltr">{u.email}</TD>
                  <TD className="text-xs">{t.roles[u.role]}</TD>
                  <TD className="num text-xs" dir="ltr">{u.phone ?? "—"}</TD>
                  <TD className="text-xs text-muted-foreground">{formatDate(u.createdAt, locale)}</TD>
                  <TD>
                    {!locked && (
                      <RowActions
                        entity="users"
                        id={u.id}
                        name={u.name}
                        active={u.isActive}
                        canArchive={u.id !== me.id}
                        canDelete={false}
                        canResetPassword
                        edit={{ title: `${t.manage.edit} · ${u.name}`, fields, record: { name: u.name, nameAr: u.nameAr ?? "", email: u.email, phone: u.phone ?? "", role: u.role, locale: u.locale } }}
                      />
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </div>
  );
}
