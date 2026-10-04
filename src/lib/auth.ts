import "server-only";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession, type SessionUser } from "./session";
import { ForbiddenError, UnauthorizedError } from "@/server/services/errors";
import { actorFromUser, type Actor } from "@/server/services/actor";

export type { SessionUser };

const DUMMY_HASH = bcrypt.hashSync("timing-equalization", 10);

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 10);
}

/** Validates credentials and returns the session payload (or null). */
export async function authenticate(email: string, password: string): Promise<SessionUser | null> {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase().trim() },
    include: { technician: { select: { id: true } }, resident: { select: { id: true } } },
  });
  if (!user || !user.isActive) {
    await bcrypt.compare(password, DUMMY_HASH); // timing equalization
    return null;
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) return null;
  return {
    id: user.id,
    name: user.name,
    nameAr: user.nameAr,
    email: user.email,
    role: user.role,
    technicianId: user.technician?.id ?? null,
    contractorId: user.contractorId ?? null,
    residentId: user.resident?.id ?? null,
  };
}

export async function startSession(user: SessionUser) {
  const token = await signSession(user);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && !process.env.APP_URL?.startsWith("http://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  return verifySession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** For server components/pages: redirects to /login when not authenticated. */
export async function requirePageUser(roles?: SessionUser["role"][]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** For API routes: throws 401/403 AppErrors. */
export async function requireApiUser(roles?: SessionUser["role"][]): Promise<{ user: SessionUser; actor: Actor }> {
  const user = await getSessionUser();
  if (!user) throw new UnauthorizedError();
  if (roles && !roles.includes(user.role)) throw new ForbiddenError();
  return { user, actor: actorFromUser(user) };
}

export function homeFor(role: SessionUser["role"]): string {
  if (role === "TECHNICIAN" || role === "CONTRACTOR") return "/my-jobs";
  if (role === "RESIDENT") return "/my-requests";
  return "/";
}

export const MANAGERS: SessionUser["role"][] = ["ADMIN", "COMPOUND_MANAGER", "MAINTENANCE_MANAGER"];
export const STAFF: SessionUser["role"][] = [...MANAGERS, "TECHNICIAN", "CONTRACTOR"];
