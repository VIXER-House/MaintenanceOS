import { requireApiUser } from "@/lib/auth";
import { route } from "@/server/http/api";
import { getTicketDetail } from "@/server/services/query.service";
import { NotFoundError } from "@/server/services/errors";

export const GET = route(async (_req, { id }) => {
  const { user } = await requireApiUser();
  const t = await getTicketDetail(id, user);
  if (!t) throw new NotFoundError("Ticket");
  return t;
});
