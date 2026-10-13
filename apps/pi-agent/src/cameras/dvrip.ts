import { createHash } from "node:crypto";
import net from "node:net";

/**
 * Cliente DVRIP/Sofia mínimo (TCP 34567, protocolo de Xiongmai/iCSee): solo login + snapshot JPEG.
 * Portado del dvrip.py que se validó contra la GT-N3 (devuelve JPEG de ~25 KB a 800×448).
 *
 * Cabecera de 20 bytes, little-endian:
 *   0 magic 0xFF | 1 versión | 4 sesión u32 | 8 secuencia u32 | 12 total u8 | 13 actual u8 | 14 msgid u16 | 16 largo u32
 * Cuerpo: JSON + "\x0a\x00" (el largo cuenta esos 2 bytes).
 */

const MSG_LOGIN = 1000;
const MSG_OPSNAP = 1560;

const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Hash de contraseña de Sofia: MD5 → pares de bytes sumados módulo 62. */
export function sofiaHash(password: string): string {
  const md5 = createHash("md5").update(password, "utf8").digest();
  let out = "";
  for (let i = 0; i < 16; i += 2) out += B62[(md5[i] + md5[i + 1]) % 62];
  return out;
}

export function buildPacket(session: number, seq: number, msgid: number, payload: unknown): Buffer {
  const body = Buffer.concat([Buffer.from(JSON.stringify(payload), "utf8"), Buffer.from([0x0a, 0x00])]);
  const header = Buffer.alloc(20);
  header[0] = 0xff;
  header[1] = 0;
  header.writeUInt32LE(session, 4);
  header.writeUInt32LE(seq, 8);
  header.writeUInt16LE(msgid, 14);
  header.writeUInt32LE(body.length, 16);
  return Buffer.concat([header, body]);
}

export type DvripPacket = { msgid: number; body: Buffer };

/** Acumula bytes y entrega paquetes completos. */
export class PacketReader {
  private buf = Buffer.alloc(0);

  push(chunk: Buffer): DvripPacket[] {
    this.buf = Buffer.concat([this.buf, chunk]);
    const out: DvripPacket[] = [];
    while (this.buf.length >= 20) {
      const len = this.buf.readUInt32LE(16);
      if (len > 8 * 1024 * 1024) throw new Error("DVRIP: paquete absurdo, se descarta la conexión");
      if (this.buf.length < 20 + len) break;
      out.push({ msgid: this.buf.readUInt16LE(14), body: this.buf.subarray(20, 20 + len) });
      this.buf = this.buf.subarray(20 + len);
    }
    return out;
  }
}

/** Busca un JPEG completo (FFD8FF … FFD9) dentro de un buffer. */
export function extractJpeg(buf: Buffer): Buffer | null {
  const start = buf.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  const end = buf.lastIndexOf(Buffer.from([0xff, 0xd9]));
  if (start === -1 || end === -1 || end <= start) return null;
  return Buffer.from(buf.subarray(start, end + 2));
}

export type SnapshotOptions = {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  channel?: number;
  timeoutMs?: number;
};

/** Abre una sesión, pide un JPEG y cierra. Rechaza si no llega nada en `timeoutMs`. */
export function takeSnapshot(opts: SnapshotOptions): Promise<Buffer> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  return new Promise<Buffer>((resolve, reject) => {
    const socket = net.createConnection({ host: opts.host, port: opts.port ?? 34567 });
    const reader = new PacketReader();
    let session = 0;
    let seq = 0;
    let stage: "login" | "snap" = "login";
    let collected = Buffer.alloc(0);
    let done = false;
    let settle: NodeJS.Timeout | undefined;

    const finish = (err: Error | null, jpeg?: Buffer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearTimeout(settle);
      socket.destroy();
      if (err) reject(err);
      else resolve(jpeg as Buffer);
    };
    const timer = setTimeout(() => finish(new Error(`DVRIP ${opts.host}: timeout`)), timeoutMs);

    const send = (msgid: number, payload: unknown) => {
      socket.write(buildPacket(session, seq, msgid, payload));
      seq += 1;
    };

    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(new Error(`DVRIP ${opts.host}: conexión cerrada`)));
    socket.on("connect", () => {
      send(MSG_LOGIN, {
        EncryptType: "MD5",
        LoginType: "DVRIP-Web",
        PassWord: sofiaHash(opts.password ?? ""),
        UserName: opts.user ?? "admin",
      });
    });
    socket.on("data", (chunk) => {
      let packets: DvripPacket[];
      try {
        packets = reader.push(chunk);
      } catch (err) {
        finish(err as Error);
        return;
      }
      for (const packet of packets) {
        if (stage === "login") {
          let reply: { Ret?: number; SessionID?: string };
          try {
            reply = JSON.parse(packet.body.toString("utf8").replace(/[\x00\x0a]+$/, ""));
          } catch {
            finish(new Error("DVRIP: respuesta de login ilegible"));
            return;
          }
          if (reply.Ret !== 100 || !reply.SessionID) {
            finish(new Error(`DVRIP login rechazado (Ret=${reply.Ret})`));
            return;
          }
          session = Number.parseInt(reply.SessionID, 16);
          stage = "snap";
          send(MSG_OPSNAP, {
            Name: "OPSNAP",
            SessionID: `0x${session.toString(16).toUpperCase().padStart(8, "0")}`,
            OPSNAP: { Channel: opts.channel ?? 0 },
          });
          continue;
        }
        collected = Buffer.concat([collected, packet.body]);
      }
      // Un FFD9 puede aparecer antes del final real; esperamos a que se calme el flujo.
      if (stage === "snap" && extractJpeg(collected)) {
        clearTimeout(settle);
        settle = setTimeout(() => {
          const jpeg = extractJpeg(collected);
          if (jpeg) finish(null, jpeg);
        }, 150);
      }
    });
  });
}
