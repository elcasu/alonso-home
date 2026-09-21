import { OfflineBanner } from "@/components/OfflineBanner";
import { readStatus } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function SaludPage() {
  const status = await readStatus();
  return (
    <div>
      <OfflineBanner online={status.online} lastSeen={status.lastSeen} usingMemory={status.usingMemory} />
      <section className="grid gap-3 sm:grid-cols-2">
        <article className="rounded-3xl bg-ink-900 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-500">Raspberry Pi</p>
          <p className="mt-2 text-2xl font-semibold">{status.online ? "En línea" : "Offline"}</p>
          <p className="mt-1 text-sm text-stone-400">
            {status.lastSeen
              ? new Date(status.lastSeen).toLocaleString("es-AR")
              : "Sin heartbeat todavía"}
          </p>
        </article>
        <article className="rounded-3xl bg-ink-900 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-500">MQTT</p>
          <p className="mt-2 text-2xl font-semibold">
            {status.mqttConnected === null ? "—" : status.mqttConnected ? "Conectado" : "Caído"}
          </p>
          <p className="mt-1 text-sm text-stone-400">Broker local para los ESP32</p>
        </article>
        <article className="rounded-3xl bg-ink-900 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-500">Store</p>
          <p className="mt-2 text-2xl font-semibold">{status.usingMemory ? "Memoria" : "Postgres"}</p>
          <p className="mt-1 text-sm text-stone-400">
            {status.usingMemory ? "Definí DATABASE_URL para Vercel" : "Persistente"}
          </p>
        </article>
        <article className="rounded-3xl bg-ink-900 p-5">
          <p className="text-xs uppercase tracking-wide text-stone-500">Zonas</p>
          <p className="mt-2 text-2xl font-semibold">
            {status.zones.filter((z) => z.on).length}/{status.zones.length} on
          </p>
        </article>
      </section>
      <h2 className="mt-8 mb-3 text-sm font-medium text-stone-400">Eventos recientes</h2>
      <ul className="space-y-2">
        {status.events.map((event, index) => (
          <li key={`${event.ts}-${index}`} className="rounded-2xl bg-ink-900 px-4 py-3 text-sm">
            <span className="text-stone-500">
              {new Date(event.ts).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
            </span>{" "}
            {event.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
