import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { readCameras } from "@/lib/cameras";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await readCameras());
}
