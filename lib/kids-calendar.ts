import type { MindBodyClass } from "./trial-types";

const KIDS_PROGRAM_NAME = /\b(?:kid|kids|children|childrens|children's|youth)\b/i;
const COURT16_KIDS_CLASS_NAME =
  /^(?:little freshman|freshman|sophomore|junior|senior|teenager)(?:\b|\/)/i;

/** Broad age bands used by Court 16's regular level names when no age is in the title. */
export function getCourt16KidsLevelAgeRange(
  title: string,
): { ageMin: number; ageMax: number } | null {
  if (/^little freshman\b/i.test(title)) return { ageMin: 3, ageMax: 3 };
  if (/^(?:freshman|sophomore)(?:\b|\/)/i.test(title)) {
    return { ageMin: 4, ageMax: 6 };
  }
  if (/^(?:junior|senior)(?:\b|\/)/i.test(title)) {
    return { ageMin: 7, ageMax: 12 };
  }
  if (/^teenager\b/i.test(title)) return { ageMin: 13, ageMax: 17 };
  return null;
}

/**
 * Defense-in-depth filter for the regular-kids schedule preview.
 *
 * The primary boundary is the per-site Program ID allowlist. Program names
 * are checked as well because several clubs use a generic "Summer Classes"
 * Program: those rows must carry Court 16's known kids level taxonomy before
 * they can leave the server. This function is never a trial-eligibility gate.
 */
export function filterConfiguredKidsSchedule(
  classes: MindBodyClass[],
  allowedProgramIds: readonly number[],
): MindBodyClass[] {
  const allowed = new Set(allowedProgramIds);
  return classes.filter((c) => {
    if (c.IsCanceled) return false;
    const program = c.ClassDescription?.Program;
    if (!program || !allowed.has(program.Id)) return false;
    const programName = program.Name ?? "";
    const className = c.ClassDescription?.Name || c.ClassName || "";
    return KIDS_PROGRAM_NAME.test(programName) || COURT16_KIDS_CLASS_NAME.test(className);
  });
}
