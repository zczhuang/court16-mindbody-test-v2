"use client";

import { LOCATIONS, type Location } from "@/config/locations";

interface Props {
  selectedId: string | null;
  onSelect: (location: Location) => void;
}

export default function LocationSelector({ selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
      {LOCATIONS.map((loc) => {
        const isSelected = selectedId === loc.id;
        return (
          <button
            key={loc.id}
            onClick={() => onSelect(loc)}
            className={`
              p-4 rounded-xl border-2 text-left transition-all
              ${
                isSelected
                  ? "border-c16-yellow bg-yellow-50 shadow-md"
                  : "border-gray-200 bg-white hover:border-c16-yellow hover:shadow-sm"
              }
            `}
          >
            <div className="text-2xl mb-1">📍</div>
            <div className="font-bold text-sm">{loc.fullName}</div>
            <div className="text-xs text-c16-gray mt-1">{loc.address}</div>
          </button>
        );
      })}
    </div>
  );
}
