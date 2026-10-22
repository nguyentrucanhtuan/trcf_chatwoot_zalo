import type { API, Credentials } from "zca-js";

/** Chụp lại phiên hiện tại (cookie có thể đã được Zalo làm mới) để lưu vào DB. */
export function snapshotCredentials(api: API): Credentials {
  const ctx = api.getContext();
  const cookies = api.getCookie().toJSON()?.cookies ?? [];
  return { imei: ctx.imei, userAgent: ctx.userAgent, cookie: cookies, language: ctx.language };
}
