/**
 * Best-effort same-instance lock for irreversible staff actions.
 *
 * This closes ordinary double-click / duplicate-POST races within one running
 * server process. Production still needs a durable distributed lock (or an
 * atomic CRM state transition) before multiple server instances are enabled.
 */
const globalForActionLocks = globalThis as typeof globalThis & {
  __court16ActiveActionLocks?: Set<string>;
};

const activeActionLocks =
  globalForActionLocks.__court16ActiveActionLocks ??
  (globalForActionLocks.__court16ActiveActionLocks = new Set<string>());

export function tryAcquireLocalActionLock(key: string): (() => void) | null {
  if (activeActionLocks.has(key)) return null;
  activeActionLocks.add(key);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeActionLocks.delete(key);
  };
}

export async function withLocalActionLock<T>(
  key: string,
  action: () => Promise<T>,
): Promise<{ acquired: true; value: T } | { acquired: false }> {
  const release = tryAcquireLocalActionLock(key);
  if (!release) return { acquired: false };

  try {
    return { acquired: true, value: await action() };
  } finally {
    release();
  }
}
