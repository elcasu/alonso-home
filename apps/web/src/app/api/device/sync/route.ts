import { NextResponse } from "next/server";
import type { SyncRequest } from "@alonso/shared";
import { bearerMatches } from "@/lib/auth";
import { handleDeviceSync } from "@/lib/store";

export async function POST(req: Request) {
  if (!bearerMatches(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as SyncRequest;
  if (!body?.heartbeat || !body.schedule || !body.zones) {
    return NextResponse.json({ error: "sync inválido" }, { status: 400 });
  }
  const result = await handleDeviceSync(body);
  return NextResponse.json(result);
}
