import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) {
    return NextResponse.json({ error: "id inválido" }, { status: 400 });
  }
  const store = await getStore();
  const snapshot = await store.getCameraSnapshot(id);
  if (!snapshot) return NextResponse.json({ error: "sin foto" }, { status: 404 });
  return new NextResponse(new Uint8Array(snapshot.data), {
    headers: {
      "content-type": snapshot.mime,
      // El id es único e inmutable: la foto nunca cambia.
      "cache-control": "private, max-age=86400, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}
