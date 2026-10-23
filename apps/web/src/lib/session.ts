export const SESSION_COOKIE = "iti_session";

export function requestOrigin(headers: Headers, fallbackUrl: string): string {
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host")?.trim();
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(fallbackUrl).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(fallbackUrl).origin;
}

export function isTrustedOrigin(headers: Headers, fallbackUrl: string, origin: string | null): boolean {
  if (!origin) return true;
  const allowed = new Set<string>([requestOrigin(headers, fallbackUrl)]);
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) {
    try {
      allowed.add(new URL(configured).origin);
    } catch {
      // A malformed configured URL does not add an extra allowed origin.
    }
  }
  return allowed.has(origin);
}

type SessionPayload = { email: string; role: "admin"; exp: number };

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, asBufferSource(new TextEncoder().encode(body)));
  return `${body}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function readSession(token: string | undefined, secret: string): Promise<SessionPayload | null> {
  if (!token || !secret) return null;
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;
  const key = await hmacKey(secret);
  const valid = await crypto.subtle.verify("HMAC", key, asBufferSource(base64UrlToBytes(signature)), asBufferSource(new TextEncoder().encode(body)));
  if (!valid) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body))) as SessionPayload;
    if (!payload.exp || payload.exp < Date.now() || payload.role !== "admin") return null;
    return payload;
  } catch {
    return null;
  }
}

async function hmacKey(secret: string) {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
