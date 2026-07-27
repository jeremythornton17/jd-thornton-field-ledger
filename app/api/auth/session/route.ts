import { NextRequest, NextResponse } from "next/server";
import {
  assertAuthorizedUser,
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
    const message =
      error instanceof Error ? error.message : "Unable to verify this account.";
    return NextResponse.json({ error: message }, { status: 403 });
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

