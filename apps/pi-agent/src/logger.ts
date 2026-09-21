export function log(message: string, extra?: unknown): void {
  const ts = new Date().toISOString();
  if (extra === undefined) {
    console.log(`[${ts}] ${message}`);
    return;
  }
  console.log(`[${ts}] ${message}`, extra);
}

export function logError(message: string, err: unknown): void {
  const ts = new Date().toISOString();
  console.error(`[${ts}] ${message}`, err);
}
