/**
 * AWS IoT confirma el destino HTTP de una regla enviando un POST sin nuestras cabeceras:
 *   x-amz-rules-engine-message-type: DestinationConfirmation
 *   { "messageType": "DestinationConfirmation", "enableUrl": "https://iot.<región>.amazonaws.com/confirmdestination/<token>", ... }
 * Para activarlo hay que abrir `enableUrl`. Solo seguimos URLs de IoT para no abrir un SSRF.
 */
export const IOT_CONFIRM_HEADER = "x-amz-rules-engine-message-type";

const IOT_HOST = /^iot\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isIotConfirmation(headers: Headers): boolean {
  return headers.get(IOT_CONFIRM_HEADER) === "DestinationConfirmation";
}

export function safeIotEnableUrl(body: unknown): URL | null {
  const raw = (body as { enableUrl?: unknown } | null)?.enableUrl;
  if (typeof raw !== "string") return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !IOT_HOST.test(url.hostname) || url.username || url.password) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export async function confirmIotDestination(body: unknown): Promise<boolean> {
  const url = safeIotEnableUrl(body);
  if (!url) return false;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  return res.ok;
}
