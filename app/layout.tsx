import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Court 16's brand typeface, self-hosted from the same Gilroy cuts the
// Squarespace site loads: Regular (body), SemiBold (h2/h3), ExtraBold
// (nav/buttons/eyebrows), Heavy (display headlines).
const gilroy = localFont({
  src: [
    { path: "../public/fonts/Gilroy-Regular.woff2", weight: "400", style: "normal" },
    { path: "../public/fonts/Gilroy-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "../public/fonts/Gilroy-ExtraBold.woff2", weight: "800", style: "normal" },
    { path: "../public/fonts/Gilroy-Heavy.woff2", weight: "900", style: "normal" },
  ],
  variable: "--font-gilroy",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Court 16 Booking | Tennis Remixed",
  description: "Choose a Court 16 club and request the tennis experience that fits your family.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={gilroy.variable}>
      <body className="app-root">{children}</body>
    </html>
  );
}
