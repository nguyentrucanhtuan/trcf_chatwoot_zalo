# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mục tiêu dự án

`trcf_chat` là hệ thống quản lý chat tập trung (omnichannel inbox) cho **Facebook Messenger, Instagram và Zalo**, dùng **Chatwoot** làm giao diện/inbox cho nhân viên.

- **Facebook & Instagram**: channel có sẵn của Chatwoot (qua Meta App). Không cần code, chỉ cấu hình.
- **Zalo cá nhân**: service `zalo-personal` (Node.js + [zca-js](https://tdung.gitbook.io/zca-js), không chính thức), đăng nhập QR, nhiều tài khoản.
- **Zalo OA**: service `zalo-oa` (Zalo OA Open API chính thức: OAuth v4 + webhook), nhiều OA.
- Mỗi tài khoản Zalo / mỗi OA nối với một **API channel inbox** của Chatwoot.
- **AI agent** trực tin nhắn khi không có nhân viên, dùng chung cho mọi kênh qua Agent Bot của Chatwoot (chưa làm).

> Trạng thái: Chatwoot chạy local; `zalo-personal` đã chạy thật với tài khoản Zalo (1-1, văn bản). `zalo-oa` đã viết xong và test giả lập (webhook ký đúng, gọi API Zalo thật bằng token giả), **chưa chạy với OA thật**.

### Quyết định đã chốt
- **Không fork/clone source Chatwoot.** Chạy image Docker chính thức, mọi tích hợp qua API/webhook/Agent Bot/cấu hình. Sửa source là phương án cuối và phải hỏi trước.
- **Hai service riêng + một package chung** (không gộp một process): `zalo-personal` và `zalo-oa` chạy, deploy, bật/tắt độc lập, mỗi service một database. Code dùng chung nằm ở `packages/bridge-core`.
- **Giữ thẻ "Zalo" / "Zalo OA" trong Add Inbox** (chèn qua `DASHBOARD_SCRIPTS`) dù không phải extension point chính thức; tab Dashboard App là đường dự phòng chính thống.
- **Không xóa contact** khi gỡ kênh/xóa inbox: contact là dữ liệu khách hàng dùng chung của account Chatwoot.
- **Không dùng Dify (tạm thời).** Bot gọi Claude trực tiếp, knowledge base trong file.

## Cấu trúc thư mục

pnpm workspace ở thư mục gốc (`pnpm-workspace.yaml`, `tsconfig.base.json`).

```
infra/chatwoot/              docker-compose.yml, .env.example, init-env.sh (Rails, Sidekiq, Postgres, Redis)
  postgres-init/             tạo database zalo_personal, zalo_oa khi volume postgres khởi tạo lần đầu
packages/bridge-core/        @trcf/bridge-core — code dùng chung, export qua src/index.ts (chạy thẳng TS bằng tsx)
  src/run.ts                 runBridge(): migrate DB, HTTP server, connector, đối chiếu inbox, shutdown
  src/http.ts                Hono: /health, /admin, /chatwoot/channel-card.js, POST /webhooks/chatwoot/:key
  src/channels/              ChannelConnector/ConnectSessions/InboundMessage (types.ts), registerChannel()
  src/bridge/                inbound (Zalo → Chatwoot), outbound (Chatwoot → Zalo), inbox-sync, KeyedQueue
  src/chatwoot/              API client, xác minh chữ ký + schema webhook Chatwoot
  src/admin/                 trang quản trị dùng chung (page.ts), auth bằng phiên Chatwoot, script thẻ kênh
  src/store/                 Drizzle schema (channels, threads), repo, mã hóa credentials
  drizzle/                   migration SQL (sinh bằng `pnpm db:generate`, commit vào repo)
services/zalo-personal/      cổng 3200, DB zalo_personal
  src/zalo/                  AccountManager (1 phiên zca-js/tài khoản), QrLoginManager, messages, credentials
services/zalo-oa/            cổng 3201, DB zalo_oa
  src/oa/                    api.ts (OAuth + OA API), oa-manager.ts (token, gửi tin, sự kiện), oauth.ts, webhook.ts, routes.ts
```

Chưa có: `src/agent/` (AI bot), `knowledge/` (knowledge base).

## Kiến trúc

```
Facebook/Instagram ─(Meta)─► Chatwoot (Docker) ◄──► Nhân viên
                               ▲  │
          Application API      │  │ API inbox callback (message_created, ký HMAC)
                               │  ▼
          ┌──────────────── @trcf/bridge-core (dùng chung) ────────────────┐
          │ inbound pipeline · outbound · inbox-sync · /admin · thẻ kênh   │
          ├───────────────────────────────┬────────────────────────────────┤
          │ zalo-personal (3200)           │ zalo-oa (3201)                 │
          │ zca-js listener, QR            │ OAuth v4 PKCE, webhook Zalo    │
          └───────────────▲───────────────┴───────────────▲────────────────┘
                 Zalo cá nhân #1..N                 Zalo OA #1..N
```

### Mô hình dữ liệu (mỗi service một database, cùng schema)
- `channels`: `key` (`zalo:<ownId>` | `oa:<oaId>`), `kind` (`zalo_personal` | `zalo_oa`), `external_id`, `display_name`, `chatwoot_inbox_id`, `webhook_secret` (secret của API inbox), `credentials` (mã hóa AES-256-GCM: Credentials zca-js hoặc OaTokens), `status`.
- `threads`: `(channel_key, thread_id)` ↔ `chatwoot_contact_id`, `chatwoot_source_id`, `chatwoot_conversation_id`, `thread_type`. Xóa channel → cascade threads.
- Contact identifier trên Chatwoot: `<channelKey>:<threadId>` (VD `zalo:123:456`, `oa:789:uid`).

### Luồng Zalo → Chatwoot (inbound, dùng chung)
1. Connector chuẩn hóa tin thành `InboundMessage` (`threadId`, `threadType`, `contactName`, `resolveContactName?`, `sourceId`, `content`) rồi gọi `onInbound(channel, message)`.
2. `bridge/inbound.ts`: tra `threads`; chưa có thì tạo contact (`resolveContactName` chỉ gọi lúc này) + conversation; 422 identifier trùng → dùng lại contact cũ.
3. `POST /conversations/{id}/messages` với `message_type: "incoming"`, `source_id` = ID tin phía Zalo. 404 (conversation bị xóa) → tạo lại một lần.
4. Mỗi thread một conversation cố định (incoming vào conversation đã resolve thì Chatwoot tự mở lại). Xử lý tuần tự theo thread bằng `KeyedQueue`.

### Luồng Chatwoot → Zalo (outbound, dùng chung)
1. Chatwoot POST `message_created` tới `/webhooks/chatwoot/<channelKey>` (callback URL của API inbox).
2. Xác minh `X-Chatwoot-Signature: sha256=HMAC_SHA256(inboxSecret, "<X-Chatwoot-Timestamp>.<raw body>")`, chỉ xử lý `message_type === "outgoing"` và `private === false`.
3. Trả 204 ngay (timeout webhook Chatwoot 5s), gọi `connector.sendText()` chạy nền, rồi `PATCH /conversations/{id}/messages/{message_id}` với `status: "delivered" | "failed"` + `external_error`. **Chatwoot không gửi lại webhook của API inbox khi lỗi**, mọi lỗi phải đánh dấu `failed`.

> Shape payload/response lấy từ source Chatwoot v4.18 (`lib/webhooks/trigger.rb`, `app/models/message.rb#webhook_data`, `app/views/api/v1/...`). Khi nâng version hoặc cần field mới, đọc lại source trong container (`docker compose exec rails sh`), đừng đoán.

### Thêm / gỡ kênh
- **Thêm**: thẻ "Zalo" / "Zalo OA" trong Settings → Inboxes → Add Inbox mở popup iframe `<service>/admin?connect`. Xong thì popup `postMessage` `zalo:connected` (origin = Chatwoot) và Chatwoot chuyển tới `/settings/inboxes/new/<inboxId>/agents` (bước thêm nhân viên có sẵn). `registerChannel()` tạo API inbox `"Zalo - <tên>"` / `"Zalo OA - <tên>"`; kênh đã có thì chỉ cập nhật credentials. Connector `connect(key)` ngay, không cần khởi động lại.
- **Gỡ = xóa inbox trên Chatwoot.** Chatwoot không có webhook `inbox_deleted` nên `bridge/inbox-sync.ts` đối chiếu `GET /inboxes` lúc khởi động và mỗi 60s, kênh mất inbox thì `connector.remove()`. Đọc danh sách channel **trước** khi lấy danh sách inbox (không xóa nhầm kênh vừa thêm); lấy inbox lỗi thì không xóa gì.

## Zalo cá nhân (`services/zalo-personal`, zca-js)

- **Thư viện không chính thức**, vi phạm chính sách Zalo → **tài khoản có thể bị khóa**. Dùng tài khoản riêng, giới hạn tốc độ gửi.
- **Mỗi tài khoản một instance `new Zalo({...})`** (để có proxy riêng) và một phiên listener. `listener.start({ retryOnClose: true })`; `closed` chỉ phát khi zca-js bỏ cuộc → service tự đăng nhập lại có backoff.
- **Mỗi tài khoản chỉ một web listener**: mở Zalo Web/PC ở nơi khác → `CloseReason.DuplicateConnection` → trạng thái `duplicate_connection`, **không tự reconnect** (tránh giành phiên), người dùng bấm "Kết nối lại" ở `/admin`.
- **QR**: `zalo.loginQR({}, callback)` trả ảnh base64 cho trang admin, không ghi file. Có callback thì zca-js không tự lưu file, và khi `QRCodeExpired`/`QRCodeDeclined` phải tự gọi `actions.abort()`/`retry()`, nếu không promise treo.
- Credentials (cookie/imei/userAgent, `snapshotCredentials`) là **bí mật**: lưu mã hóa, lưu lại định kỳ 30 phút, không log, không commit.
- Tin nhóm hiện bị bỏ qua; ảnh/file hiện dạng `[Ảnh] <link>` (bước "Ảnh, file và nhóm").
- Proxy (chưa làm): Node.js dùng `agent: new HttpProxyAgent(url)` kèm `polyfill: nodefetch`.
- zca-js 2.2.0 có `index.d.ts` gốc lỗi với `moduleResolution: NodeNext`, `services/zalo-personal/tsconfig.json` dùng `paths` trỏ về `dist/index.d.ts`. Luôn tra type definitions trong `node_modules/zca-js` trước khi dùng API.

## Zalo OA (`services/zalo-oa`, Open API chính thức)

Nguồn: developers.zalo.me/docs/official-account (bản đọc được: `https://stc-developers.zdn.vn/docs/v2/official-account/<path>?lang=vi`) và SDK chính thức github.com/zaloplatform.

- **Yêu cầu phía Zalo**: OA đã xác thực + gói **Tăng trưởng hoặc Toàn diện** mới liên kết app qua API; một app trên developers.zalo.me được nhiều OA cấp quyền. Khai báo trong app: **Callback URL** `<BRIDGE_EXTERNAL_URL>/zalo-oa/callback`, **Webhook URL** `<BRIDGE_EXTERNAL_URL>/zalo-oa/webhook` (HTTPS, domain phải xác thực trong app; service in ra 2 URL này lúc khởi động) và bật các sự kiện `user_send_*`.
- **OAuth v4 + PKCE**: `https://oauth.zaloapp.com/v4/oa/permission?app_id&redirect_uri&code_challenge&state`; đổi code tại `POST https://oauth.zaloapp.com/v4/oa/access_token` (form-urlencoded, header `secret_key`). Callback chạy trên domain công khai nên **không có cookie Chatwoot**: `state` ngẫu nhiên do phiên admin tạo là bằng chứng xác thực.
- **Token**: access token 25 giờ; refresh token 3 tháng, **dùng một lần và được xoay vòng** (token cũ mất hiệu lực ngay khi có token mới). `OaManager.refresh()` single-flight mỗi OA, **lưu DB ngay** cặp token mới, làm mới trước hạn 1 giờ; lỗi mà access token cũ hết hạn → `needs_relogin` ("Cấp quyền lại").
- **Webhook**: `X-ZEvent-Signature: mac=` + hex(**sha256 thường**, không phải HMAC)(appId + raw body + `timestamp` trong body + OA Secret Key). Phải trả 200 **trong 2 giây** → xử lý nền. Zalo chỉ retry khi không mở được kết nối (30s → 1h), lỗi kéo dài thì webhook bị tắt. Chống trùng theo `msg_id`. Chỉ chuyển `user_send_*`; `oa_send_*` (echo tin OA gửi) bị bỏ qua để tránh vòng lặp.
- **Gửi tin tư vấn**: `POST https://openapi.zalo.me/v3.0/oa/message/cs` (header `access_token`), tối đa 2000 ký tự. Chỉ gửi được khi người dùng tương tác trong **7 ngày**; miễn phí trong 48 giờ (không giới hạn số tin từ 1/1/2026), ngoài 48 giờ tính phí/quota. OA API trả HTTP 200 kèm `error` ≠ 0 khi lỗi; mã lỗi hay gặp có thông điệp tiếng Việt trong `oa/api.ts` (`-216/-220` token → làm mới rồi gửi lại một lần).
- Tên khách: `GET /v3.0/oa/user/detail?data={"user_id":...}` → `display_name`, chỉ gọi khi tạo contact mới (`resolveContactName`).
- `GET /v2.0/oa/getoa` (lấy oa_id + tên sau khi cấp quyền) theo SDK chính thức, chưa thấy trong tài liệu mới.
- Khi dev: cần tunnel HTTPS công khai tới cổng 3201 cho `BRIDGE_EXTERNAL_URL`.

## AI agent trực tin nhắn (chưa làm)

Dùng **Agent Bot** của Chatwoot: bot gắn vào inbox, nhận webhook, trả lời bằng tin `outgoing` → chạy được cho mọi kênh (tin của bot vào inbox Zalo đi qua outbound như tin nhân viên).

- Tạo Agent Bot (`POST /api/v1/accounts/{account_id}/agent_bots` hoặc Settings) với `outgoing_url` trỏ về service, gắn vào inbox. Conversation mới ở `pending` → bot xử lý. Bot trả lời bằng **access token của bot**. Handoff: `POST /conversations/{id}/toggle_status` `status: "open"` (kèm ghi chú nội bộ tóm tắt); sau khi `open` bot không trả lời nữa. Các endpoint này viết theo trí nhớ, đối chiếu source Chatwoot trước khi code.
- Khi nào bot trả lời (cấu hình được, mặc định kết hợp): ngoài giờ làm việc của inbox; không có nhân viên online (`GET /agents` → `availability_status`); khách chờ quá N phút.
- Quy tắc: bỏ qua mọi event không phải tin `incoming` của khách; chỉ trả lời dựa trên `knowledge/`; không bịa giá/chính sách, không xác nhận đơn/thanh toán; handoff khi khách đòi gặp người, khiếu nại, ngoài knowledge base, liên quan tiền/đơn, hoặc không chắc; nói rõ là trợ lý tự động; context lấy từ `GET /conversations/{id}/messages`; tiếng Việt ngắn gọn, không markdown phức tạp.
- LLM: Claude qua `@anthropic-ai/sdk`, model mặc định `claude-opus-5-5` (chat ngắn → `output_config.effort: "low"`). Đọc skill `claude-api` trước khi viết code. Kiểm tra `stop_reason` (đặc biệt `refusal`); lỗi/refusal → handoff. Prompt caching cho system prompt + knowledge base.

## Chatwoot

- Docker Compose trong `infra/chatwoot/`, image chính thức **pin version** (`v4.18.0`). Database của Chatwoot là `chatwoot_production`.
- Dev local: Chatwoot http://localhost:3100, Postgres `localhost:5433` (máy dev có service khác chiếm 3000/5432). Biến cổng host tên `*_HOST_PORT`. **Không đặt `POSTGRES_PORT` trong `.env`** (Chatwoot đọc nó làm cổng DB trong mạng Docker).
- `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` là bắt buộc (Chatwoot mặc định chặn webhook tới IP nội bộ). Dev: service chạy trên host, Chatwoot gọi `http://host.docker.internal:<port>`. **Không thêm `extra_hosts: host-gateway`**: nó thêm bản ghi IPv6, Ruby chọn IPv6 trước và webhook lỗi "Network unreachable" (tin "Failed to send"). Kiểm tra bằng đúng HTTP client của Chatwoot: `docker compose exec sidekiq bundle exec rails runner 'SafeFetch.fetch("http://host.docker.internal:3200/health", validate_content_type: false) { |r| puts r.tempfile.read }'`. Production Linux: chạy service trong cùng Docker network, gọi bằng tên service.
- Service gọi API bằng `api_access_token` của **user Administrator** (cần để tạo inbox và đọc `secret` của inbox). Inbox tạo qua API chưa có nhân viên: thêm ở Settings → Inboxes → Collaborators (bước "Thêm đại lý" sau khi kết nối).
- **`DASHBOARD_SCRIPTS`** (Installation Config, đặt qua Super Admin → Settings hoặc `rails runner` + `GlobalConfig.clear_cache`):
  ```html
  <script src="http://localhost:3200/chatwoot/channel-card.js"></script>
  <script src="http://localhost:3201/chatwoot/channel-card.js"></script>
  ```
  Script (`bridge-core/src/admin/channel-card-script.ts`) clone thẻ API trong lưới `.grid > button` (chỉ tìm trong lưới vì sidebar cũng có icon `.i-woot-api`). Dựa vào DOM Chatwoot v4.18 (`ChannelList.vue`, `ChannelSelector.vue`): nâng version phải kiểm tra lại. Inbox vẫn hiện icon API (đổi icon cần fork). Production phải sửa URL.
- **Dashboard App "Zalo"** (Settings → Integrations → Dashboard Apps, URL `http://localhost:3200/admin`): tab trong màn hình cuộc chat. Có thể thêm "Zalo OA" trỏ `http://localhost:3201/admin`.
- **Trang `/admin` không có mật khẩu riêng**: đọc cookie `cw_d_session_info` của dashboard Chatwoot (header devise_token_auth `access-token`/`client`/`uid`), gọi `GET /api/v1/profile` kiểm tra user là **administrator** của `CHATWOOT_ACCOUNT_ID` (cache 60s). Phải **cùng host với Chatwoot**: dev dùng `localhost` (không dùng 127.0.0.1), production cùng domain qua reverse proxy. POST yêu cầu header `x-requested-with: zalo-admin` (chống CSRF).
- Facebook/Instagram cần Meta App (`FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `IG_VERIFY_TOKEN`, bản mới cấu hình trong `/super_admin`), domain HTTPS công khai, và **App Review** (nộp sớm).
- Tính năng Enterprise (SAML, Captain, SLA, Custom Roles, Audit Logs...) bị khóa bằng license; không sửa source để mở.
- Tài liệu: https://developers.chatwoot.com

## Lộ trình

1. ~~Chatwoot~~ · 2. ~~Bridge 1 tài khoản Zalo~~ · 3. Nhiều tài khoản (đã có; còn proxy, rate limit gửi theo tài khoản) · Zalo OA (đã viết, cần chạy với OA thật)
4. **Ảnh, file và nhóm**: attachment hai chiều (cá nhân: `sendMessage` `attachments`; OA: upload `/v2.0/oa/upload/image|file`), tin nhắn nhóm (cá nhân), reaction/undo nếu kịp.
5. **AI agent**: Agent Bot, điều kiện kích hoạt, knowledge base, handoff.
6. **Production**: deploy VPS, HTTPS + reverse proxy cùng domain, backup Postgres, giám sát.

Facebook + Instagram không nằm trong lộ trình code (chỉ cấu hình).

## Quy ước code

- Node.js (LTS) + TypeScript, ESM, `moduleResolution: NodeNext` (import tương đối có đuôi `.js`). Service chạy thẳng TS bằng `tsx` (cả production) vì `@trcf/bridge-core` export file `.ts`.
- Code dùng chung cho cả hai kênh đặt trong `packages/bridge-core` và export qua `src/index.ts`; code riêng một kênh ở trong service đó. Service mới = `runBridge({ name, card, ui, createConnector, createConnectSessions, extendApp? })`.
- Cấu hình qua env, mỗi service một `.env` (không commit) từ `.env.example`. Biến chung: `HOST`, `PORT`, `BRIDGE_PUBLIC_URL` (URL Chatwoot gọi về service), `CHATWOOT_BASE_URL`, `CHATWOOT_PUBLIC_URL?`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_TOKEN`, `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`, `LOG_LEVEL`. Riêng OA: `ZALO_APP_ID`, `ZALO_APP_SECRET`, `ZALO_OA_SECRET_KEY`, `BRIDGE_EXTERNAL_URL`. Cấu hình từng kênh (inbox, secret, credentials) nằm trong DB.
- Handler phải idempotent và không làm crash process: bắt lỗi từng tin, log kèm `channel`/`threadId`/`conversationId`, không log nội dung tin hay credentials.
- Tiếng Việt có dấu: UTF-8 xuyên suốt; comment, log, thông báo giao diện bằng tiếng Việt.

## Lệnh thường dùng

Chatwoot (`cd infra/chatwoot`):
```bash
./init-env.sh                                                         # lần đầu: tạo .env với secret ngẫu nhiên
docker compose up -d postgres redis
docker compose run --rm rails bundle exec rails db:chatwoot_prepare   # lần đầu / sau khi nâng version
docker compose up -d
docker compose logs -f rails sidekiq
curl http://localhost:3100/api                                        # version + trạng thái
```

Bridge (thư mục gốc):
```bash
pnpm install
pnpm dev:personal          # services/zalo-personal (tsx watch), tự migrate DB khi khởi động
pnpm dev:oa                # services/zalo-oa, cần ZALO_* + BRIDGE_EXTERNAL_URL trong .env
pnpm typecheck             # cả 3 package
pnpm db:generate           # sau khi sửa packages/bridge-core/src/store/schema.ts
open http://localhost:3200/admin        # quản trị Zalo cá nhân (cần đăng nhập Chatwoot bằng admin)
open http://localhost:3201/admin        # quản trị Zalo OA
curl http://localhost:3200/health       # số kênh / số đang online
```

Chưa có test tự động và lint.

Ghi chú:
- Không đặt script tên `login` trong package.json: `pnpm login` là lệnh có sẵn của pnpm (đăng nhập npm).
- pnpm 11 chặn build script mặc định: `pnpm-workspace.yaml` ở gốc cho phép `esbuild` (cần cho tsx).
- Script ngoài workspace (VD trong scratchpad) không phân giải được `@trcf/bridge-core`: import bằng đường dẫn tuyệt đối tới `packages/bridge-core/src/index.ts`.
