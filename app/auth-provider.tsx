"use client";

import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { firebaseAuth } from "@/lib/firebase-client";

type AuthContextValue = {
  user: User;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const companyDomain =
  process.env.NEXT_PUBLIC_ALLOWED_EMAIL_DOMAIN || "jdtnurseries.com";

async function establishServerSession(user: User) {
  const idToken = await user.getIdToken(true);
  const response = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(result.error || "Unable to start a secure session.");
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, async (nextUser) => {
        setError("");
        if (!nextUser) {
          setUser(null);
          setReady(true);
          return;
        }
        try {
          await establishServerSession(nextUser);
          setUser(nextUser);
        } catch (sessionError) {
          await firebaseSignOut(firebaseAuth);
          setUser(null);
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "Unable to verify this account.",
          );
        } finally {
          setReady(true);
        }
      }),
    [],
  );

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ hd: companyDomain });
      const result = await signInWithPopup(firebaseAuth, provider);
      await establishServerSession(result.user);
      setUser(result.user);
    } catch (signInError) {
      setError(
        signInError instanceof Error
          ? signInError.message
          : "Google sign-in was not completed.",
      );
    } finally {
      setSigningIn(false);
      setReady(true);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => {});
    await firebaseSignOut(firebaseAuth);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user: user as User, signOut }),
    [user, signOut],
  );

  if (!ready) {
    return (
      <main className="auth-shell" aria-busy="true">
        <section className="auth-card">
          <div className="auth-mark">JT</div>
          <p className="eyebrow">JD Thornton Nurseries</p>
          <h1>Opening Field Ledger…</h1>
          <p>Verifying your secure Firebase session.</p>
        </section>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-mark">JT</div>
          <p className="eyebrow">JDT Command Center</p>
          <h1>Field Ledger</h1>
          <p>
            Sign in with your verified @{companyDomain} Google account to view
            farm inventory, work history, and client orders.
          </p>
          {error ? <div className="auth-error" role="alert">{error}</div> : null}
          <button
            type="button"
            className="auth-button"
            disabled={signingIn}
            onClick={signIn}
          >
            {signingIn ? "Signing in…" : "Continue with Google"}
          </button>
        </section>
      </main>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAppAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAppAuth must be used inside AuthProvider.");
  return value;
}
