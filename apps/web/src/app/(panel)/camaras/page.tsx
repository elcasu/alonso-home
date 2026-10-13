import { CameraBoard } from "@/components/CameraBoard";
import { readCameras } from "@/lib/cameras";

export const dynamic = "force-dynamic";

export default async function CamarasPage() {
  const initial = await readCameras();
  return <CameraBoard initial={initial} />;
}
