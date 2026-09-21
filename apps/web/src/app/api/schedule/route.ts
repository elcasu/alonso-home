import { NextResponse } from "next/server";
import type { Schedule } from "@alonso/shared";
import { requireUser } from "@/lib/auth";
import { getStore, saveSchedule } from "@/lib/store";

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await getStore();
  return NextResponse.json(await store.getSchedule());
}

export async function PUT(req: Request) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = (await req.json()) as Schedule;
  if (!body?.rules || !Array.isArray(body.rules)) {
    return NextResponse.json({ error: "agenda inválida" }, { status: 400 });
  }
  return NextResponse.json(await saveSchedule(body));
}
