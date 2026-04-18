import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Court 16 — MindBody Happy Path Test",
  description: "De-risks the BLINK failure mode before Phase 3 build.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif", background: "#fafafa", color: "#111" }}>
        {children}
      </body>
    </html>
  );
}
