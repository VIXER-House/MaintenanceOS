import { requireApiUser } from "@/lib/auth";
import { route } from "@/server/http/api";

export const GET = route(async () => (await requireApiUser()).user);
