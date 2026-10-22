import type { Logger } from "@trcf/bridge-core";
import { Hono } from "hono";
import { oaConfig } from "../config.js";
import type { OaManager } from "./oa-manager.js";
import type { OaConnectSessions } from "./oauth.js";
import { OaEvent, verifyZaloSignature } from "./webhook.js";

/** Route công khai (qua BRIDGE_EXTERNAL_URL) mà Zalo gọi tới: callback OAuth và webhook. */
export function createOaRoutes(deps: { oa: OaManager; connectSessions: OaConnectSessions; log: Logger }) {
  const routes = new Hono();

  routes.get("/callback", async (c) => {
    const result = await deps.connectSessions.handleCallback({
      state: c.req.query("state"),
      code: c.req.query("code"),
      oaId: c.req.query("oa_id"),
    });
    return c.html(callbackPage(result.ok, result.message), result.ok ? 200 : 400);
  });

  routes.post("/webhook", async (c) => {
    const rawBody = await c.req.text();
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return c.text("invalid json", 400);
    }
    const parsed = OaEvent.safeParse(json);
    if (!parsed.success) {
      deps.log.warn({ issues: parsed.error.issues }, "Webhook Zalo OA không đúng định dạng");
      return c.text("invalid event", 400);
    }
    const event = parsed.data;
    const ok =
      event.app_id === oaConfig.appId &&
      verifyZaloSignature(
        oaConfig.appId,
        rawBody,
        event.timestamp,
        oaConfig.oaSecretKey,
        c.req.header("x-zevent-signature"),
      );
    if (!ok) {
      deps.log.warn({ event: event.event_name }, "Webhook Zalo OA sai chữ ký");
      return c.text("invalid signature", 401);
    }
    // Zalo yêu cầu trả 200 trong 2 giây: xử lý nền.
    deps.oa.handleEvent(event);
    return c.text("ok");
  });

  return routes;
}

function callbackPage(ok: boolean, message: string): string {
  const escaped = message.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zalo OA</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 system-ui,sans-serif;padding:16px;
background:#f6f7f9;color:#1d2330}@media(prefers-color-scheme:dark){body{background:#0f1218;color:#e5e7eb}}
main{max-width:420px;text-align:center}</style></head>
<body><main><h1 style="font-size:20px">${ok ? "✓ Thành công" : "Không kết nối được"}</h1><p>${escaped}</p></main>
${ok ? "<script>setTimeout(() => window.close(), 1500)</script>" : ""}</body></html>`;
}
