import { NextResponse } from "next/server";
import { bearerMatches } from "@/lib/auth";
import { ingestCameraMessages } from "@/lib/cameras";
import { confirmIotDestination, isIotConfirmation } from "@/lib/iot";

/**
 * Entrada de eventos y status de cámaras. La llaman:
 * - la regla HTTP de AWS IoT (cabecera Authorization con el DEVICE_TOKEN), y
 * - la Pi directamente cuando CAMERA_SINK=http (desarrollo).
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // El handshake de confirmación de AWS IoT llega sin nuestro token.
  if (isIotConfirmation(req.headers)) {
    const ok = await confirmIotDestination(body);
    return NextResponse.json({ confirmed: ok }, { status: ok ? 200 : 400 });
  }

  if (!bearerMatches(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await ingestCameraMessages(body);
  if (result.accepted + result.duplicates === 0 && result.rejected > 0) {
    return NextResponse.json({ error: "mensaje inválido", ...result }, { status: 400 });
  }
  return NextResponse.json(result);
}
