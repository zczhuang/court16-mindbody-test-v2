"use client";

import { useState } from "react";

export interface ChildEntry {
  label: string;
  age: number;
}

interface Props {
  /** Current selection (from parent state). */
  value: ChildEntry[];
  /** Called whenever the internal list changes. */
  onChange: (children: ChildEntry[]) => void;
}

/**
 * Age bands match the Court 16 HubSpot form's `childage` dropdown. The
 * stored number is the top of the band, which our server then maps back
 * to the exact band string (`2.5 - 3 yo`, `7 - 8 yo`, …) when submitting.
 */
const AGE_BANDS = [
  { label: "Ages 2½–3", value: 3 },
  { label: "Age 4", value: 4 },
  { label: "Ages 5–6", value: 6 },
  { label: "Ages 7–8", value: 8 },
  { label: "Ages 9–11", value: 11 },
  { label: "Ages 12–15", value: 15 },
  { label: "15 and older", value: 17 },
];

/**
 * Compact kid picker. Dropdown per kid, + button to add up to 4.
 * Doesn't gate a Continue button — caller owns the "proceed" CTA because
 * this selector is now rendered alongside a location selector.
 */
export default function AgeSelector({ value, onChange }: Props) {
  const [kids, setKids] = useState<ChildEntry[]>(
    value.length > 0 ? value : [{ label: "Kid 1", age: 0 }],
  );

  function update(next: ChildEntry[]) {
    setKids(next);
    onChange(next);
  }

  function setAge(index: number, age: number) {
    update(kids.map((k, i) => (i === index ? { ...k, age } : k)));
  }
  function addKid() {
    if (kids.length >= 4) return;
    update([...kids, { label: `Kid ${kids.length + 1}`, age: 0 }]);
  }
  function removeKid(index: number) {
    if (kids.length <= 1) return;
    const next = kids.filter((_, i) => i !== index).map((k, i) => ({ ...k, label: `Kid ${i + 1}` }));
    update(next);
  }

  return (
    <div className="space-y-3">
      {kids.map((kid, idx) => (
        <div
          key={idx}
          className="flex items-center gap-3 p-3 bg-white border border-gray-200 rounded-xl"
        >
          <span className="w-8 h-8 shrink-0 rounded-full bg-c16-yellow flex items-center justify-center text-xs font-bold">
            {idx + 1}
          </span>
          <label className="text-sm font-semibold text-c16-black min-w-[56px]">
            {kid.label}
          </label>
          <div className="relative flex-1">
            <select
              value={kid.age || ""}
              onChange={(e) => setAge(idx, Number(e.target.value))}
              className="w-full appearance-none bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 pr-8 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-c16-yellow"
            >
              <option value="" disabled>
                Select age…
              </option>
              {AGE_BANDS.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-c16-gray-dark">
              ▾
            </span>
          </div>
          {kids.length > 1 && (
            <button
              onClick={() => removeKid(idx)}
              className="text-xs font-semibold text-c16-gray-dark hover:text-red-500 transition-colors px-2"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      {kids.length < 4 && (
        <button
          onClick={addKid}
          className="text-sm font-semibold text-c16-gray-dark hover:text-c16-black transition-colors flex items-center gap-2"
        >
          <span className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-base leading-none">
            +
          </span>
          Add another child
        </button>
      )}
    </div>
  );
}
