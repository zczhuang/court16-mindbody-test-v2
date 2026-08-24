import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Free Kids Tennis Trial | Court 16",
  description:
    "Request a free kids tennis trial at Court 16. Choose a club and an age-appropriate class, and our team will confirm the spot.",
};

export default function TrialLayout({ children }: { children: React.ReactNode }) {
  return children;
}
