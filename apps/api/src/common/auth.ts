// Who is calling. Two ways in, same users table:
//   - Bearer token (mobile app): POST /api/auth/token → HS256 JWT, 30 days.
//   - NextAuth session cookie (web pages, same origin through the Next.js rewrite): the
//     encrypted JWT NextAuth v4 writes, decrypted with NEXTAUTH_SECRET.
// Role and office are read from the database on every request, so a change applies at once and
// a deleted account gets 401 (same as the old requireUser()).
import { hkdf } from "@panva/hkdf";
import type { Request } from "express";
import { jwtDecrypt, jwtVerify, SignJWT } from "jose";
import { hasRole, type Role } from "@alarm/core";
import { prisma } from "@alarm/db";
import { HttpError } from "./http.js";

export interface AuthUser {
  id: number;
  email: string;
  role: Role;
  office: string | null;
}

const FORBIDDEN: Partial<Record<Role, string>> = {
  ADMIN: "Admin only",
  HOTLINE: "Hotline or super admin only",
  SUPER_ADMIN: "Super admin only",
};

export const TOKEN_DAYS = 30;
const TOKEN_ISSUER = "alarm-api";

function secret(): string {
  const s = process.env.API_JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("API_JWT_SECRET or NEXTAUTH_SECRET must be set");
  return s;
}

// ---------------------------------------------------------------- Bearer (mobile)

export async function signApiToken(userId: number): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + TOKEN_DAYS * 86_400_000);
  const token = await new SignJWT({ typ: "api" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuer(TOKEN_ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(new TextEncoder().encode(secret()));
  return { token, expiresAt };
}

async function bearerUserId(token: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret()), {
      issuer: TOKEN_ISSUER,
      algorithms: ["HS256"],
    });
    return payload.typ === "api" ? Number(payload.sub) || null : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- NextAuth cookie (web)

const SESSION_COOKIES = ["__Secure-next-auth.session-token", "next-auth.session-token"];

function cookiesOf(req: Request): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const name = part.slice(0, i).trim();
    try {
      out.set(name, decodeURIComponent(part.slice(i + 1).trim()));
    } catch {
      out.set(name, part.slice(i + 1).trim());
    }
  }
  return out;
}

export function readCookie(req: Request, name: string): string | undefined {
  return cookiesOf(req).get(name);
}

/** NextAuth splits a large session token into name.0, name.1, … */
function sessionToken(req: Request): string | undefined {
  const jar = cookiesOf(req);
  for (const name of SESSION_COOKIES) {
    if (jar.has(name)) return jar.get(name);
    const chunks = [...jar.keys()]
      .filter((k) => k.startsWith(`${name}.`))
      .sort((a, b) => Number(a.split(".").pop()) - Number(b.split(".").pop()));
    if (chunks.length) return chunks.map((k) => jar.get(k)).join("");
  }
  return undefined;
}

/** Same derivation as next-auth/jwt decode() (v4). */
async function nextAuthUserId(token: string): Promise<number | null> {
  const nextSecret = process.env.NEXTAUTH_SECRET;
  if (!nextSecret) return null;
  try {
    const key = await hkdf("sha256", nextSecret, "", "NextAuth.js Generated Encryption Key", 32);
    const { payload } = await jwtDecrypt(token, key, { clockTolerance: 15 });
    return Number(payload.sub) || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- guard logic

/** 401 when not signed in (or the account was deleted). */
export async function authenticate(req: Request): Promise<AuthUser> {
  const auth = req.headers.authorization;
  let id: number | null = null;
  if (auth?.startsWith("Bearer ")) id = await bearerUserId(auth.slice(7).trim());
  else {
    const t = sessionToken(req);
    if (t) id = await nextAuthUserId(t);
  }
  if (!id) throw new HttpError(401, "Not signed in");
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, email: true, role: true, office: true },
  });
  if (!user) throw new HttpError(401, "Account no longer exists — sign in again");
  return user;
}

/** 403 when the user's role is below `role`. */
export function requireRole(user: AuthUser, role?: Role): AuthUser {
  if (role && !hasRole(user.role, role))
    throw new HttpError(403, FORBIDDEN[role] ?? `${role.toLowerCase()} role required`);
  return user;
}
