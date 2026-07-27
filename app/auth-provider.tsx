"use client";

import {
  browserLocalPersistence,
  getRedirectResult,
  GoogleAuthProvider,
  onAuthStateChanged,
  setPersistence,
  signInWithRedirect,
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

function isPhoneOrInstalledApp() {
  if (typeof window === "undefined") return false;
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in window.navigator &&
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true);
  const phone =
    /Android|iPhone|iPad|iPod|Mobile/i.test(window.navigator.userAgent);
  return installed || phone;
}

function authErrorMessage(error: unknown) {
  const code =
    typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";

  if (code === "auth/popup-closed-by-user") {
    return "Google sign-in was closed before it finished. Please try again.";
  }
  if (code === "auth/network-request-failed") {
    return "The phone lost its connection during sign-in. Check the connection and try again.";
  }
  if (code === "auth/unauthorized-domain") {
    return "This Field Ledger address is not authorized for Google sign-in.";
  }
  if (
    code === "auth/web-storage-unsupported" ||
    code === "auth/operation-not-supported-in-this-environment"
  ) {
    return "This browser is blocking the secure sign-in handoff. Open Field Ledger in Safari or Chrome and try again.";
  }
  return error instanceof Error
    ? error.message
    : "Google sign-in was not completed.";
}

function googleProvider() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ hd: companyDomain, prompt: "select_account" });
  return provider;
}

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

  useEffect(() => {
    let active = true;
    let unsubscribe = () => {};

    async function initializeAuth() {
      try {
        await setPersistence(firebaseAuth, browserLocalPersistence);
        await getRedirectResult(firebaseAuth);
      } catch (redirectError) {
        if (active) setError(authErrorMessage(redirectError));
      }

      if (!active) return;
      unsubscribe = onAuthStateChanged(firebaseAuth, async (nextUser) => {
        if (!active) return;
        if (!nextUser) {
          setUser(null);
          setReady(true);
          return;
        }
        setError("");
        try {
          await establishServerSession(nextUser);
          if (!active) return;
          setUser(nextUser);
        } catch (sessionError) {
          await firebaseSignOut(firebaseAuth);
          if (!active) return;
          setUser(null);
          setError(
            sessionError instanceof Error
              ? sessionError.message
              : "Unable to verify this account.",
          );
        } finally {
          if (active) setReady(true);
        }
      });
    }

    void initializeAuth();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async () => {
    setSigningIn(true);
    setError("");
    try {
      await setPersistence(firebaseAuth, browserLocalPersistence);
      const provider = googleProvider();

      if (isPhoneOrInstalledApp()) {
        await signInWithRedirect(firebaseAuth, provider);
        return;
      }

      const result = await signInWithPopup(firebaseAuth, provider);
      await establishServerSession(result.user);
      setUser(result.user);
    } catch (signInError) {
      const code =
        typeof signInError === "object" && signInError && "code" in signInError
          ? String(signInError.code)
          : "";
      if (
        code === "auth/popup-blocked" ||
        code === "auth/cancelled-popup-request" ||
        code === "auth/operation-not-supported-in-this-environment"
      ) {
        try {
          await signInWithRedirect(firebaseAuth, googleProvider());
          return;
        } catch (redirectError) {
          setError(authErrorMessage(redirectError));
        }
      } else {
        setError(authErrorMessage(signInError));
      }
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
          <p className="auth-help">
            Phone tip: after signing in, use your browser menu and choose
            <strong> Add to Home Screen</strong> for one-tap access.
          </p>
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
