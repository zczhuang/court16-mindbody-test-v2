import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Court 16 | Book a Kids Trial",
  description: "Book a free trial class for your child at Court 16 Tennis Remixed",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full scroll-smooth antialiased">
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
