import { createHmac, createHash, timingSafeEqual, randomBytes } from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "alonso_session";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name}`);
  }
  return value;
}

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || "dev-only-change-me-alonso-home-secret";
}

export function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || "cambiame";
}

export function deviceToken(): string {
  return process.env.DEVICE_TOKEN || "dev-device-token";
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function createSessionToken(): string {
  const exp = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
  return `${exp}.${hmac(exp, sessionSecret())}`;
}

export function isSessionTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = hmac(exp, sessionSecret());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function passwordMatches(input: string): boolean {
  const left = createHash("sha256").update(input).digest();
  const right = createHash("sha256").update(adminPassword()).digest();
  return timingSafeEqual(left, right);
}

export function bearerMatches(header: string | null): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const got = Buffer.from(header.slice(7));
  const expected = Buffer.from(deviceToken());
  if (got.length !== expected.length) return false;
  return timingSafeEqual(got, expected);
}

export async function getSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
}

export async function requireUser(): Promise<void> {
  const token = await getSessionCookie();
  if (!isSessionTokenValid(token)) {
    throw Object.assign(new Error("unauthorized"), { status: 401 });
  }
}

export function newId(): string {
  return randomBytes(8).toString("hex");
}

export { required };
