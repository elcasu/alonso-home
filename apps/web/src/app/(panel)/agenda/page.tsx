import { ScheduleEditor } from "@/components/ScheduleEditor";
import { readStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function AgendaPage() {
  const status = await readStatus();
  return (
    <div>
      <p className="mb-5 text-sm text-stone-400">
        Horarios en hora local de la Pi (America/Argentina/Buenos_Aires). El jitter evita un patrón
        de máquina. Un pulse enciende y apaga a los N minutos.
      </p>
      <ScheduleEditor
        initial={status.schedule}
        zoneOptions={status.zones.map((z) => ({ id: z.id, name: z.name }))}
      />
    </div>
  );
}
