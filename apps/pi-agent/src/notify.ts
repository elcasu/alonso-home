import { spawnSync } from "node:child_process";
import { logError } from "./logger.js";

/**
 * Avisa a systemd (READY / WATCHDOG). Tiene que ir con NotifyAccess=all en la
 * unidad: systemd-notify es un proceso hijo y, con el default (main), se ignora.
 */
function notify(args: string[]): void {
  if (!process.env.NOTIFY_SOCKET) return;
  const result = spawnSync("/usr/bin/systemd-notify", args, {
    env: process.env,
    encoding: "utf8",
  });
  if (result.error || (result.status !== null && result.status !== 0)) {
    logError(
      `systemd-notify ${args.join(" ")}`,
      result.error ?? new Error(result.stderr.trim() || `exit ${result.status}`),
    );
  }
}

export function notifyReady(): void {
  notify(["--ready"]);
}

export function notifyWatchdog(): void {
  notify(["WATCHDOG=1"]);
}
