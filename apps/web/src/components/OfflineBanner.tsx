"use client";

export function OfflineBanner({
  online,
  lastSeen,
  usingMemory,
}: {
  online: boolean;
  lastSeen: string | null;
  usingMemory: boolean;
}) {
  if (usingMemory && !lastSeen) {
    return (
      <div className="mb-5 rounded-2xl border border-amber-glow/20 bg-amber-glow/10 px-4 py-3 text-sm text-amber-100">
        Panel en modo local (sin Postgres). La Pi aparece desconectada hasta el primer sync.
      </div>
    );
  }
  if (online) return null;
  return (
    <div className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
      <strong>Pi offline.</strong>{" "}
      {lastSeen
        ? `Último heartbeat: ${new Date(lastSeen).toLocaleString("es-AR")}.`
        : "Todavía no hubo heartbeat."}{" "}
      Las luces siguen la agenda local en la casa.
    </div>
  );
}
