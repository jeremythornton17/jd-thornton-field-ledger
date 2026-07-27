import type { Metadata } from "next";
import { headers } from "next/headers";
import { AuthProvider } from "./auth-provider";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") || requestHeaders.get("host") || "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") || (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  const title = "Field Ledger | JD Thornton Nurseries";
  const description = "Farm-based tree inventory, irrigation zone, field work, and client order tracking.";
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1792, height: 939 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><AuthProvider>{children}</AuthProvider></body></html>;
}
