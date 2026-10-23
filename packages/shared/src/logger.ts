type Level = "debug" | "info" | "warn" | "error";

const RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function current(): Level {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") return raw;
  return "info";
}

function write(level: Level, message: string, fields?: Record<string, unknown>) {
  if (RANK[level] < RANK[current()]) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    message,
    ...fields,
  };
  const stream = level === "error" || level === "warn" ? console.error : console.log;
  stream(JSON.stringify(line));
}

export const logger = {
  debug: (message: string, fields?: Record<string, unknown>) => write("debug", message, fields),
  info: (message: string, fields?: Record<string, unknown>) => write("info", message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => write("warn", message, fields),
  error: (message: string, fields?: Record<string, unknown>) => write("error", message, fields),
};
