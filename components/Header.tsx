"use client";

import Link from "next/link";
import { getLocationById } from "@/config/locations";

interface Props {
  locationId?: string;
}

export default function Header({ locationId }: Props) {
  const enrollUrl = locationId
    ? `https://court-16-online-enrollment.onrender.com/enroll?location=${locationId}`
    : "https://court-16-online-enrollment.onrender.com/enroll";
  const location = locationId ? getLocationById(locationId) : null;
  const loginUrl = "https://clients.mindbodyonline.com/ASP/main_class.asp";

  return (
    <header className="sticky top-0 z-50 bg-white border-b border-gray-100">
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between h-16">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-10 h-10 rounded-full bg-c16-yellow flex items-center justify-center font-bold text-sm border-2 border-c16-black">
            C16
          </div>
          <span className="font-extrabold text-lg tracking-tight hidden sm:inline">
            TENNIS REMIXED
          </span>
        </Link>

        <div className="flex items-center gap-1 sm:gap-2">
          <Link
            href="/trial"
            className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg bg-c16-yellow text-c16-black hover:bg-yellow-300 transition-colors"
          >
            Free Trial
          </Link>
          <Link
            href={enrollUrl}
            className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            target="_blank"
            title={location ? `Enroll at ${location.name}` : "Enroll for the season"}
          >
            Enroll
          </Link>

          <span className="hidden sm:inline text-gray-300 mx-1">|</span>

          <Link
            href="https://www.court16.com/adults"
            className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            target="_blank"
          >
            Adults
          </Link>

          <Link
            href={loginUrl}
            className="px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg hover:bg-gray-100 transition-colors"
            target="_blank"
          >
            My Account
          </Link>
        </div>
      </nav>
    </header>
  );
}
