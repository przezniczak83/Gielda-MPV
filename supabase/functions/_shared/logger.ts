export function createLogger(functionName: string) {
  const prefix = `[${functionName}]`;
  return {
    info:  (msg: string, data?: unknown) => console.log(`${prefix} INFO:`, msg, data ?? ""),
    warn:  (msg: string, data?: unknown) => console.warn(`${prefix} WARN:`, msg, data ?? ""),
    error: (msg: string, data?: unknown) => console.error(`${prefix} ERROR:`, msg, data ?? ""),
    debug: (msg: string, data?: unknown) => console.log(`${prefix} DEBUG:`, msg, data ?? ""),
  };
}
