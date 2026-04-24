// Tiny structured logger with a correlation ID so we can trace a single
// happy-path run across 4+ MindBody calls. Output is line-delimited JSON,
// which plays well with Vercel's log drain.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  level: LogLevel;
  msg: string;
  correlationId: string;
  ts: string;
  [key: string]: unknown;
}

export function makeCorrelationId(): string {
  // Short, URL-safe, human-copyable.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function createLogger(correlationId: string) {
  const emit = (level: LogLevel, msg: string, extra: Record<string, unknown> = {}) => {
    const record: LogRecord = {
      level,
      msg,
      correlationId,
      ts: new Date().toISOString(),
      ...extra,
    };
    // One JSON line per log. Redact any field called "password" out of paranoia.
    const safe = JSON.parse(JSON.stringify(record, (k, v) => (k === "password" ? "[REDACTED]" : v)));
    console.log(JSON.stringify(safe));
  };

  return {
    correlationId,
    debug: (msg: string, extra?: Record<string, unknown>) => emit("debug", msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => emit("info", msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => emit("warn", msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => emit("error", msg, extra),
  };
}

export type Logger = ReturnType<typeof createLogger>;
