import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthorizedUser,
  AuthError,
  SESSION_COOKIE,
  SESSION_MAX_AGE_MS,
} from "@/lib/auth";
import { adminAuth } from "@/lib/firebase-admin";

export async function POST(request: NextRequest) {
  try {
    const { idToken } = (await request.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json(
        { error: "A Firebase ID token is required." },
        { status: 400 },
      );
    }

    assertAuthorizedUser(await adminAuth.verifyIdToken(idToken, true));
    const sessionCookie = await adminAuth.createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_MS,
    });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(SESSION_MAX_AGE_MS / 1000),
    });
    return response;
  } catch (error) {
    if (error instanceof SyntaxError) {
      return NextResponse.json(
        { error: "The sign-in request was malformed. Try signing in again." },
        { status: 400 },
      );
    }
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const errorCode =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (errorCode.startsWith("auth/")) {
      return NextResponse.json(
        { error: "Unable to verify this account. Sign in again." },
        { status: 403 },
      );
    }
    console.error("Unable to create a Field Ledger session.", error);
    return NextResponse.json(
      { error: "Unable to start a secure session. Try again." },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
