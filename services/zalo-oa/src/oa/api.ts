// Client cho Zalo OA Open API (OAuth v4 + OA API v2/v3). Nguồn: developers.zalo.me/docs/official-account
// và SDK chính thức github.com/zaloplatform (zalo-php-sdk, zalo-java-sdk).
import { createHash, randomBytes } from "node:crypto";
import { oaConfig } from "../config.js";

const OAUTH_BASE = "https://oauth.zaloapp.com/v4/oa";
const OPENAPI_BASE = "https://openapi.zalo.me";
const TIMEOUT_MS = 15_000;

export type OaTokens = {
  accessToken: string;
  refreshToken: string;
  /** epoch ms */
  accessTokenExpiresAt: number;
};

// Thông điệp dễ hiểu cho các mã lỗi hay gặp (developers.zalo.me/docs/official-account/phu-luc/ma-loi).
const ERROR_HINTS: Record<number, string> = {
  [-32]: "Vượt giới hạn tốc độ gọi API",
  [-211]: "Hết quota gửi tin",
  [-213]: "Người dùng chưa quan tâm OA",
  [-216]: "Access token không hợp lệ",
  [-220]: "Access token đã hết hạn",
  [-221]: "OA chưa được xác thực",
  [-223]: "OA chưa cấp quyền API này cho app",
  [-224]: "OA cần nâng cấp gói dịch vụ",
  [-230]: "Người dùng không tương tác với OA trong 7 ngày qua, không gửi được tin tư vấn",
  [-232]: "Đã hết thời hạn tương tác để gửi tin tư vấn",
};

export class OaApiError extends Error {
  constructor(
    readonly code: number,
    readonly apiMessage: string,
  ) {
    super(`${ERROR_HINTS[code] ?? apiMessage} (Zalo ${code})`);
  }

  get isTokenError(): boolean {
    return this.code === -216 || this.code === -220;
  }
}

/** Lỗi khi lấy/làm mới token (refresh token hết hạn, đã dùng, bị thu hồi...). */
export class OaAuthError extends Error {}

// --- OAuth v4 với PKCE ---

export function createPkce(): { codeVerifier: string; codeChallenge: string } {
  // Verifier 43 ký tự chữ + số, mới cho mỗi lần cấp quyền.
  const codeVerifier = randomBytes(32).toString("base64url").replace(/[-_]/g, "0").slice(0, 43);
  const codeChallenge = createHash("sha256").update(codeVerifier, "ascii").digest("base64url");
  return { codeVerifier, codeChallenge };
}

export function buildAuthorizationUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    app_id: oaConfig.appId,
    redirect_uri: oaConfig.callbackUrl,
    code_challenge: codeChallenge,
    state,
  });
  return `${OAUTH_BASE}/permission?${params}`;
}

async function requestTokens(body: Record<string, string>): Promise<OaTokens> {
  const res = await fetch(`${OAUTH_BASE}/access_token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", secret_key: oaConfig.appSecret },
    body: new URLSearchParams({ app_id: oaConfig.appId, ...body }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: string | number;
    error?: number;
    error_name?: string;
    error_description?: string;
  };
  if (!res.ok || !json.access_token || !json.refresh_token) {
    throw new OaAuthError(
      `Zalo từ chối cấp token: ${json.error_description ?? json.error_name ?? res.statusText} (${json.error ?? res.status})`,
    );
  }
  // expires_in là chuỗi số giây (thường "90000" = 25 giờ).
  const expiresIn = Number(json.expires_in) || 90_000;
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    accessTokenExpiresAt: Date.now() + expiresIn * 1000,
  };
}

export function exchangeCode(code: string, codeVerifier: string): Promise<OaTokens> {
  return requestTokens({ code, grant_type: "authorization_code", code_verifier: codeVerifier });
}

/** Refresh token chỉ dùng được một lần: phải lưu ngay cặp token mới trả về. */
export function refreshTokens(refreshToken: string): Promise<OaTokens> {
  return requestTokens({ refresh_token: refreshToken, grant_type: "refresh_token" });
}

// --- OA API ---

async function callOa<T>(accessToken: string, method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${OPENAPI_BASE}${path}`, {
    method,
    headers: { access_token: accessToken, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({ error: res.status, message: res.statusText }))) as {
    error?: number;
    message?: string;
    data?: T;
  };
  // OA API trả HTTP 200 kèm `error` khác 0 khi lỗi.
  if (json.error !== undefined && json.error !== 0) throw new OaApiError(json.error, json.message ?? "");
  if (!res.ok) throw new OaApiError(res.status, res.statusText);
  return json.data as T;
}

export async function getOaInfo(accessToken: string): Promise<{ oaId: string; name: string }> {
  const data = await callOa<{ oa_id: string | number; name: string }>(accessToken, "GET", "/v2.0/oa/getoa");
  return { oaId: String(data.oa_id), name: data.name };
}

export async function getUserDisplayName(accessToken: string, userId: string): Promise<string> {
  const query = encodeURIComponent(JSON.stringify({ user_id: userId }));
  const data = await callOa<{ display_name?: string }>(accessToken, "GET", `/v3.0/oa/user/detail?data=${query}`);
  return data.display_name || `Zalo ${userId}`;
}

/** Tin tư vấn dạng văn bản (tối đa 2000 ký tự). */
export async function sendTextMessage(accessToken: string, userId: string, text: string): Promise<void> {
  await callOa(accessToken, "POST", "/v3.0/oa/message/cs", {
    recipient: { user_id: userId },
    message: { text },
  });
}
