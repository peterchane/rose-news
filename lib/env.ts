/** Fail loudly at use-time rather than shipping a half-configured brief. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function optional(name: string, fallback: string): string {
  return process.env[name] || fallback;
}
