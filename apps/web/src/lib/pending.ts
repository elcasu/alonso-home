import type { RuleAction, ZoneState } from "@alonso/shared";

export type PendingCommand = {
  zoneId: string;
  action: RuleAction;
  phase: "sending" | "queued";
  since: number;
  initialOn: boolean;
};

export const PENDING_TIMEOUT_MS = 25_000;

export function wantZoneOn(action: RuleAction): boolean {
  return action !== "off";
}

export function pendingLabel(pending: PendingCommand): string {
  return pending.phase === "sending" ? "Enviando" : "En cola";
}

export function pendingSatisfied(
  pending: PendingCommand,
  zone: Pick<ZoneState, "id" | "on"> | undefined,
  lastSeen: string | null,
  now = Date.now(),
): "pending" | "done" | "timeout" {
  if (now - pending.since > PENDING_TIMEOUT_MS) return "timeout";
  if (pending.phase === "sending") return "pending";
  if (!zone) return "pending";
  if (zone.on !== wantZoneOn(pending.action)) return "pending";
  if (zone.on !== pending.initialOn) return "done";
  const seen = lastSeen ? Date.parse(lastSeen) : 0;
  return seen > pending.since ? "done" : "pending";
}
