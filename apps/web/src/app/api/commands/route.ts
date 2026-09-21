import { NextResponse } from "next/server";
import type { RuleAction } from "@alonso/shared";
import { requireUser } from "@/lib/auth";
import { queueCommand } from "@/lib/store";

export async function POST(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as {
    zoneId?: string;
    action?: RuleAction;
    durationMinutes?: number;
  };
  if (!body.zoneId || !body.action) {
    return NextResponse.json({ error: "zoneId y action son requeridos" }, { status: 400 });
  }
  const command = await queueCommand(body.zoneId, body.action, body.durationMinutes);
  return NextResponse.json({ command });
}
