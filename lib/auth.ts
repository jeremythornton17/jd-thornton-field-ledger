import type { DecodedIdToken } from "firebase-admin/auth";
import type { NextRequest } from "next/server";
import { adminAuth } from "./firebase-admin";

export const SESSION_COOKIE = "__session";
export const SESSION_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;

export class AuthError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

function allowedDomain() {
  return (
    process.env.ALLOWED_EMAIL_DOMAIN ||
    process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN ||
    "jdtnurseries.com"
  ).toLowerCase();
}

export function assertAuthorizedUser(token: DecodedIdToken) {
  const email = token.email?.toLowerCase();
  if (!email || token.email_verified !== true) {
    throw new AuthError("A verified company Google account is required.", 403);
  }
  if (!email.endsWith(`@${allowedDomain()}`)) {
    throw new AuthError(
      `Field Ledger is limited to verified @${allowedDomain()} accounts.`,
      403,
    );
  }
  return token;
}

export async function requireApiUser(request: NextRequest | Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = cookieHeader
    .split(";")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);

  if (!session) throw new AuthError("Sign in is required.");
  try {
    return assertAuthorizedUser(
      await adminAuth.verifySessionCookie(decodeURIComponent(session), true),
    );
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError("Your session has expired. Sign in again.");
  }
}

export function authErrorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}

