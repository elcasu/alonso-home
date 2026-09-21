import http from "node:http";
import type { RuleAction } from "@alonso/shared";
import type { ZoneController } from "./controller.js";
import type { AgentStore } from "./db.js";
import { log, logError } from "./logger.js";
import type { MqttBridge } from "./mqtt.js";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(chunk as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "http://127.0.0.1",
  });
  res.end(JSON.stringify(body));
}

export function startLocalApi(
  port: number,
  store: AgentStore,
  controller: ZoneController,
  mqtt: MqttBridge,
): http.Server {
  const server = http.createServer(async (req, res) => {
    const host = req.headers.host ?? "";
    if (!host.startsWith("127.0.0.1") && !host.startsWith("localhost")) {
      json(res, 403, { error: "solo localhost" });
      return;
    }
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method === "GET" && url.pathname === "/status") {
        json(res, 200, {
          zones: store.getZones(),
          schedule: store.getSchedule(),
          mqttConnected: mqtt.connected,
          events: store.recentEvents(20),
        });
        return;
      }
      const zoneMatch = url.pathname.match(/^\/zones\/([^/]+)$/);
      if (req.method === "POST" && zoneMatch) {
        const body = JSON.parse((await readBody(req)) || "{}") as {
          on?: boolean;
          action?: RuleAction;
          durationMinutes?: number;
        };
        const zoneId = decodeURIComponent(zoneMatch[1]);
        if (body.action) {
          await controller.applyAction(
            zoneId,
            body.action,
            body.durationMinutes,
            "api local",
          );
        } else {
          await controller.set(zoneId, Boolean(body.on), "api local");
        }
        json(res, 200, { zones: store.getZones() });
        return;
      }
      json(res, 404, { error: "not found" });
    } catch (err) {
      logError("api local", err);
      json(res, 500, { error: "internal" });
    }
  });
  server.listen(port, "127.0.0.1", () => {
    log(`API local http://127.0.0.1:${port}/status`);
  });
  return server;
}
