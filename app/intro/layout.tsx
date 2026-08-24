import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Adult Tennis Intro | Court 16",
  description: "Choose a Court 16 club, verified intro offer, and available adult class.",
};

export default function IntroLayout({ children }: { children: React.ReactNode }) {
  return children;
}
