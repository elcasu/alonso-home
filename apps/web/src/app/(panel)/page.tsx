import { Dashboard } from "@/components/Dashboard";
import { readStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const status = await readStatus();
  return <Dashboard initial={status} />;
}
