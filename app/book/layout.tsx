import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Book at Court 16 | Tennis Remixed",
  description: "Choose a Court 16 club, then start a kids trial or an adult intro.",
};

export default function BookLayout({ children }: { children: React.ReactNode }) {
  return children;
}
