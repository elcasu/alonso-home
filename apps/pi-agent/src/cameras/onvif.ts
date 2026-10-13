import { createHash, randomBytes } from "node:crypto";

/**
 * Cliente mínimo ONVIF Events (PullPoint) para cámaras GeoTek/Xiongmai (GT-N3, firmware V5.01).
 * Hallazgos con la cámara real:
 * - El servicio ONVIF está en :8899 (en :80 no hay nada).
 * - PullMessages ignora el Timeout y contesta al instante → hay que dormir ~1 s entre pulls.
 * - Al suscribirse manda el estado actual de cada topic con PropertyOperation="Initialized".
 */

export type OnvifNotification = {
  topic: string;
  utc: string;
  operation: string;
  items: Record<string, string>;
};

export type CameraSignal = {
  kind: "motion" | "tamper";
  active: boolean;
  /** Estado inicial al suscribirse (no es una transición real). */
  initial: boolean;
};

const NS =
  'xmlns:s="http://www.w3.org/2003/05/soap-envelope" ' +
  'xmlns:a="http://www.w3.org/2005/08/addressing" ' +
  'xmlns:tev="http://www.onvif.org/ver10/events/wsdl" ' +
  'xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2"';

const ACTION_CREATE = "http://www.onvif.org/ver10/events/wsdl/EventPortType/CreatePullPointSubscriptionRequest";
const ACTION_PULL = "http://www.onvif.org/ver10/events/wsdl/PullPointSubscription/PullMessagesRequest";

export function parseNotifications(xml: string): OnvifNotification[] {
  const out: OnvifNotification[] = [];
  const blocks = xml.matchAll(/<wsnt:NotificationMessage>([\s\S]*?)<\/wsnt:NotificationMessage>/g);
  for (const block of blocks) {
    const chunk = block[1];
    const topic = /<wsnt:Topic[^>]*>([^<]+)</.exec(chunk)?.[1]?.trim();
    const msg = /<tt:Message\s+UtcTime="([^"]*)"\s+PropertyOperation="([^"]*)"/.exec(chunk);
    if (!topic) continue;
    const items: Record<string, string> = {};
    for (const item of chunk.matchAll(/<tt:SimpleItem\s+Name="([^"]+)"\s+Value="([^"]*)"/g)) {
      items[item[1]] = item[2];
    }
    out.push({ topic, utc: msg?.[1] ?? "", operation: msg?.[2] ?? "", items });
  }
  return out;
}

/** Traduce una notificación ONVIF a "movimiento/sabotaje activo o no". Ignora el resto de los topics. */
export function toSignal(n: OnvifNotification): CameraSignal | null {
  const initial = n.operation === "Initialized";
  const flag = (name: string): boolean | null => {
    const raw = n.items[name];
    if (raw === undefined) return null;
    return raw === "true" || raw === "1";
  };
  if (n.topic.endsWith("VideoSource/MotionAlarm")) {
    const active = flag("State");
    return active === null ? null : { kind: "motion", active, initial };
  }
  if (n.topic.endsWith("RuleEngine/CellMotionDetector/Motion")) {
    const active = flag("IsMotion");
    return active === null ? null : { kind: "motion", active, initial };
  }
  if (n.topic.endsWith("RuleEngine/TamperDetector/Tamper")) {
    const active = flag("IsTamper");
    return active === null ? null : { kind: "tamper", active, initial };
  }
  return null;
}

/** Elemento WS-Security UsernameToken (PasswordDigest) para cuando la cámara tenga contraseña. */
export function usernameTokenHeader(
  user: string,
  password: string,
  now = new Date(),
  nonce: Buffer = randomBytes(16),
): string {
  const created = now.toISOString();
  const digest = createHash("sha1")
    .update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)]))
    .digest("base64");
  return (
    '<Security s:mustUnderstand="1" ' +
    'xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    "<UsernameToken>" +
    `<Username>${escapeXml(user)}</Username>` +
    '<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">' +
    `${digest}</Password>` +
    '<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">' +
    `${nonce.toString("base64")}</Nonce>` +
    '<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">' +
    `${created}</Created>` +
    "</UsernameToken></Security>"
  );
}

function escapeXml(value: string): string {
  return value.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export type OnvifWatcherOptions = {
  host: string;
  port: number;
  user?: string;
  password?: string;
  /** Segundos de vida de la suscripción (la GT-N3 la limita a ~180 s); se renueva a la mitad. */
  subscriptionTtlSec?: number;
  pollIntervalMs?: number;
  onSignal(signal: CameraSignal): void;
  onConnection(connected: boolean): void;
  onError?(message: string, err: unknown): void;
  fetchImpl?: typeof fetch;
};

export type OnvifWatcher = { connected(): boolean; stop(): void };

export function startOnvifWatcher(opts: OnvifWatcherOptions): OnvifWatcher {
  const base = `http://${opts.host}:${opts.port}`;
  const ttl = opts.subscriptionTtlSec ?? 120;
  const pollMs = opts.pollIntervalMs ?? 1000;
  const doFetch = opts.fetchImpl ?? fetch;
  let stopped = false;
  let connected = false;
  let wake: (() => void) | undefined;

  const setConnected = (value: boolean) => {
    if (connected === value) return;
    connected = value;
    opts.onConnection(value);
  };

  /**
   * `wsaTo`: dirección de la suscripción. Esta cámara solo acepta Renew con WS-Addressing
   * (wsa:Action + wsa:To); sin eso responde ResourceUnknownFault. Se manda en todo lo de la suscripción.
   */
  async function soap(url: string, body: string, action: string, wsaTo?: string): Promise<string> {
    const parts: string[] = [];
    if (wsaTo) {
      parts.push(
        `<a:Action s:mustUnderstand="1">${action}</a:Action><a:To s:mustUnderstand="1">${escapeXml(wsaTo)}</a:To>`,
      );
    }
    if (opts.user && opts.password) parts.push(usernameTokenHeader(opts.user, opts.password));
    const header = parts.length > 0 ? `<s:Header>${parts.join("")}</s:Header>` : "";
    const envelope = `<?xml version="1.0" encoding="utf-8"?><s:Envelope ${NS}>${header}<s:Body>${body}</s:Body></s:Envelope>`;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": `application/soap+xml; charset=utf-8; action="${action}"` },
      body: envelope,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    if (!res.ok || /<s:Fault>|<SOAP-ENV:Fault>/.test(text)) {
      throw new Error(`ONVIF HTTP ${res.status} ${text.slice(0, 160).replace(/\s+/g, " ")}`);
    }
    return text;
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function session(): Promise<void> {
    const created = await soap(
      `${base}/onvif/event_service`,
      `<tev:CreatePullPointSubscription><tev:InitialTerminationTime>PT${ttl}S</tev:InitialTerminationTime></tev:CreatePullPointSubscription>`,
      ACTION_CREATE,
    );
    const address = /<wsa:Address>([^<]+)</.exec(created)?.[1];
    if (!address) throw new Error("ONVIF: la respuesta no trae dirección de suscripción");
    // La cámara puede anunciar su IP interna; usamos el host configurado y solo el path.
    const subUrl = `${base}${new URL(address).pathname}`;
    setConnected(true);
    let renewAt = Date.now() + (ttl * 1000) / 2;
    while (!stopped) {
      if (Date.now() >= renewAt) {
        await soap(
          subUrl,
          `<wsnt:Renew><wsnt:TerminationTime>PT${ttl}S</wsnt:TerminationTime></wsnt:Renew>`,
          "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest",
          address,
        );
        renewAt = Date.now() + (ttl * 1000) / 2;
      }
      const xml = await soap(
        subUrl,
        "<tev:PullMessages><tev:Timeout>PT1S</tev:Timeout><tev:MessageLimit>20</tev:MessageLimit></tev:PullMessages>",
        ACTION_PULL,
        address,
      );
      for (const notification of parseNotifications(xml)) {
        const signal = toSignal(notification);
        if (signal) opts.onSignal(signal);
      }
      await sleep(pollMs);
    }
    // Al apagar liberamos la suscripción (la cámara tiene pocas y las viejas ocupan lugar hasta vencer).
    await soap(
      subUrl,
      "<wsnt:Unsubscribe/>",
      "http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest",
      address,
    ).catch(() => undefined);
  }

  void (async () => {
    let backoff = 2000;
    while (!stopped) {
      try {
        await session();
        backoff = 2000;
      } catch (err) {
        setConnected(false);
        opts.onError?.(`ONVIF ${opts.host}`, err);
        if (stopped) break;
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
    setConnected(false);
  })();

  return {
    connected: () => connected,
    stop() {
      stopped = true;
      wake?.();
    },
  };
}
