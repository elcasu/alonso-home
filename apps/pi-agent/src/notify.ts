import { execFile } from "node:child_process";

function notify(args: string[]): void {
  if (!process.env.NOTIFY_SOCKET) return;
  execFile("systemd-notify", args, () => {
    /* ignore missing binary outside systemd */
  });
}

export function notifyReady(): void {
  notify(["--ready"]);
}

export function notifyWatchdog(): void {
  notify(["WATCHDOG=1"]);
}
