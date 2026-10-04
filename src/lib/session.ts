import { SignJWT, jwtVerify } from "jose";

/** Edge-safe session token helpers (used by middleware and server code). */
export const SESSION_COOKIE = "mos_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  name: string;
  nameAr: string | null;
  email: string;
  role: "ADMIN" | "COMPOUND_MANAGER" | "MAINTENANCE_MANAGER" | "TECHNICIAN" | "CONTRACTOR" | "RESIDENT";
  technicianId: string | null;
  contractorId: string | null;
  residentId: string | null;
}

function secret() {
  return new TextEncoder().encode(process.env.AUTH_SECRET || "insecure-dev-secret-change-me-0123456789abcdef");
}

export async function signSession(user: SessionUser): Promise<string> {
  return new SignJWT({ user })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

export async function verifySession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return (payload.user as SessionUser) ?? null;
  } catch {
    return null;
  }
}
