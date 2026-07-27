import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { AuthProvider } from "./auth-provider";
import { RegisterServiceWorker } from "./register-service-worker";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#183b32",
};

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
    applicationName: "Field Ledger",
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      statusBarStyle: "black-translucent",
      title: "Field Ledger",
    },
    icons: {
      icon: [
        { url: "/icons/192", sizes: "192x192", type: "image/png" },
        { url: "/icons/512", sizes: "512x512", type: "image/png" },
      ],
      apple: [
        { url: "/icons/180", sizes: "180x180", type: "image/png" },
      ],
    },
    other: {
      "mobile-web-app-capable": "yes",
      "apple-mobile-web-app-capable": "yes",
      "apple-mobile-web-app-status-bar-style": "black-translucent",
    },
    openGraph: { title, description, images: [{ url: image, width: 1792, height: 939 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <RegisterServiceWorker />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
