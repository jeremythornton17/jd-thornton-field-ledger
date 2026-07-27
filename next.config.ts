import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: "/__/auth/:path*",
          destination:
            "https://jdt-command-board.firebaseapp.com/__/auth/:path*",
        },
        {
          source: "/__/firebase/init.json",
          destination:
            "https://jdt-command-board.firebaseapp.com/__/firebase/init.json",
        },
      ],
    };
  },
};

export default nextConfig;
