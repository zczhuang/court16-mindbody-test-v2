import Link from "next/link";
import Header from "@/components/Header";

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <Header />

      <main className="max-w-3xl mx-auto px-4 py-16 text-center">
        <div className="mb-12">
          <h1 className="text-5xl sm:text-6xl font-extrabold tracking-tight mb-4">
            Get Started at
            <br />
            Court 16
          </h1>
          <p className="text-lg text-c16-gray-dark max-w-md mx-auto">
            Tennis for kids and adults at 6 locations across NY, PA, and MA.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto mb-16">
          <Link
            href="/trial"
            className="p-6 rounded-xl border-2 border-c16-yellow bg-yellow-50 hover:shadow-lg transition-all text-left"
          >
            <div className="text-3xl mb-3">🎾</div>
            <h2 className="font-extrabold text-lg mb-1">For Kids</h2>
            <p className="text-sm font-semibold text-c16-black mb-2">
              Book a Free Trial
            </p>
            <p className="text-xs text-c16-gray-dark">
              Ages 3&ndash;17. Browse real classes, pick a time, and we&apos;ll confirm within hours.
            </p>
          </Link>

          <a
            href="https://www.court16.com/adults"
            target="_blank"
            rel="noopener noreferrer"
            className="p-6 rounded-xl border-2 border-gray-200 bg-white hover:border-c16-yellow hover:shadow-lg transition-all text-left"
          >
            <div className="text-3xl mb-3">🏸</div>
            <h2 className="font-extrabold text-lg mb-1">For Adults</h2>
            <p className="text-sm font-semibold text-c16-black mb-2">Try a Class</p>
            <p className="text-xs text-c16-gray-dark">
              Intro offers from $58. Drop-in classes, memberships, and social tennis.
            </p>
          </a>
        </div>

        <h3 className="font-bold text-sm text-c16-gray-dark uppercase tracking-wide mb-6">
          How the kids free trial works
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-left">
          <div className="p-6 bg-gray-50 rounded-xl">
            <div className="text-3xl mb-3">🎾</div>
            <h3 className="font-bold mb-1">Real class experience</h3>
            <p className="text-sm text-c16-gray-dark">
              Your child joins an actual group class with peers their age — not a staged demo.
            </p>
          </div>
          <div className="p-6 bg-gray-50 rounded-xl">
            <div className="text-3xl mb-3">📅</div>
            <h3 className="font-bold mb-1">Pick your time</h3>
            <p className="text-sm text-c16-gray-dark">
              Browse available classes filtered by your child&apos;s age. No guessing, no back-and-forth.
            </p>
          </div>
          <div className="p-6 bg-gray-50 rounded-xl">
            <div className="text-3xl mb-3">⚡</div>
            <h3 className="font-bold mb-1">Confirmed in hours</h3>
            <p className="text-sm text-c16-gray-dark">
              Our team matches your child to the perfect class and confirms within a few hours.
            </p>
          </div>
        </div>

        <div className="mt-16">
          <p className="text-sm text-gray-400 font-semibold tracking-wide">
            6 LOCATIONS ACROSS NY · PA · MA
          </p>
        </div>
      </main>
    </div>
  );
}
