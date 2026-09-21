import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { readStatus } from "@/lib/store";

export async function GET() {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await readStatus());
}
