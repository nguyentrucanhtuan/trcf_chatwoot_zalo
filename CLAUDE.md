# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mục tiêu dự án

`trcf_chat` là hệ thống quản lý chat tập trung (omnichannel inbox) cho **Facebook Messenger, Instagram và Zalo**, dùng **Chatwoot** làm giao diện/inbox cho nhân viên.

- **Facebook & Instagram**: dùng channel có sẵn của Chatwoot (qua Meta App). Không cần viết code tích hợp, chỉ cấu hình.
- **Zalo**: Chatwoot không hỗ trợ Zalo cá nhân → tự viết **zalo-bridge** (Node.js + [zca-js](https://tdung.gitbook.io/zca-js)) hỗ trợ **nhiều tài khoản Zalo**, mỗi tài khoản nối với một **API channel inbox** của Chatwoot.
- **AI agent** trực tin nhắn khi không có nhân viên, dùng chung cho cả 3 kênh qua Agent Bot của Chatwoot.

> Trạng thái: đã dựng Chatwoot (bước 1) và code MVP zalo-bridge (bước 2: 1-1, văn bản). Chưa chạy thử end-to-end với tài khoản Zalo thật.

### Quyết định đã chốt
- **Không fork/clone source Chatwoot.** Chạy image Docker chính thức (`chatwoot/chatwoot`) bằng Docker Compose, mọi tích hợp đi qua API/webhook. Muốn đổi hành vi Chatwoot thì tìm cách qua API, Agent Bot hoặc cấu hình trước. Sửa source là phương án cuối và phải hỏi trước.
- **Không dùng Dify (tạm thời).** Bot gọi Claude trực tiếp, knowledge base để trong file. Giữ phần gọi LLM tách riêng trong `agent/` để sau này có thể thay bằng Dify nếu cần.

## Cấu trúc thư mục

```
infra/chatwoot/            docker-compose.yml, .env.example, init-env.sh (Rails, Sidekiq, Postgres, Redis)
  postgres-init/           tạo database `zalo_bridge` khi volume postgres khởi tạo lần đầu
services/zalo-bridge/      Node.js + TypeScript (pnpm)
  src/index.ts             entrypoint: migrate DB, HTTP server, AccountManager
  src/http.ts              Hono: GET /health (chỉ số lượng), POST /webhooks/chatwoot/:ownId, mount /admin
  src/admin/               chatwoot-script.ts (thẻ kênh Zalo chèn vào Chatwoot), trang quản trị (đăng nhập bằng phiên Chatwoot Administrator): danh sách tài khoản, nút quét QR, kết nối lại
  src/zalo/                AccountManager (1 phiên zca-js/tài khoản, reconnect), QrLoginManager, đăng ký tài khoản
  src/chatwoot/            API client, xác minh chữ ký + schema payload webhook
  src/store/               Drizzle schema, repo, mã hóa credentials, migrate
  src/bridge/              inbound (Zalo → Chatwoot), outbound (Chatwoot → Zalo), KeyedQueue
  drizzle/                 migration SQL (sinh bằng `pnpm db:generate`, commit vào repo)
  src/agent/               (chưa có) AI bot
knowledge/                 (chưa có) knowledge base cho bot
```

## Kiến trúc

```
Facebook ─┐
Instagram ┴─(Meta webhook)──► Chatwoot (Docker) ◄──► Nhân viên (Web/App)
                                ▲   │   │
          Application API       │   │   │ Agent Bot webhook
          (contact/conv/msg)    │   │   ▼
                                │   │  agent/ ──► Claude API
                                │   │ API inbox callback (message_created)
                                │   ▼
                    ┌──────────────────────────────────┐
                    │        zalo-bridge (Node.js)      │
                    │  AccountManager: Zalo #1 … #N     │
                    │  mỗi account = 1 Zalo instance    │
                    │  + 1 API inbox + proxy riêng      │
                    └──────────────────────────────────┘
                          ▲ │            ▲ │
                          │ ▼            │ ▼
                     Zalo acc #1   …  Zalo acc #N
```

### Luồng Zalo → Chatwoot (inbound)
1. Listener của tài khoản `ownId` nhận `UserMessage | GroupMessage` với `msg.type` (`ThreadType.User` / `ThreadType.Group`), `msg.threadId`, `msg.isSelf`, `msg.data`.
2. Bỏ qua `msg.isSelf === true` (tránh vòng lặp khi bridge tự gửi tin).
3. Tra mapping theo khóa **`(ownId, threadId)`**. Nếu chưa có:
   - `POST /api/v1/accounts/{account_id}/contacts` với `inbox_id` (inbox của tài khoản đó), `name`, `identifier = "zalo:<ownId>:<threadId>"` → lấy `contact_inboxes[].source_id`. Khóa có `ownId` vì chưa chắc ID người dùng Zalo giống nhau khi nhìn từ các tài khoản khác nhau.
   - `POST /api/v1/accounts/{account_id}/conversations` với `source_id`, `inbox_id`, `contact_id`.
4. `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages` với `message_type: "incoming"`. File/ảnh gửi dạng multipart `attachments[]`.
5. Tin nhắn nhóm: **một nhóm Zalo = một contact + một conversation**. Thêm tên người gửi vào đầu nội dung (VD `Tên: nội dung`) vì Chatwoot không phân biệt nhiều người gửi trong một contact.

### Luồng Chatwoot → Zalo (outbound)
1. Chatwoot POST tới callback URL của API inbox với `event: "message_created"`.
2. **Chỉ xử lý** khi `message_type === "outgoing"` và `private === false` (bỏ qua tin `incoming` do bridge tạo và ghi chú nội bộ). Tin của AI bot cũng là `outgoing` nên cũng được gửi đi theo luồng này.
3. Từ `inbox.id` trong payload → tài khoản Zalo tương ứng. Từ conversation → `threadId` + `ThreadType`. Gọi `api.sendMessage(content | { msg, attachments, quote }, threadId, threadType)` bằng **đúng instance của tài khoản đó**. Attachment của Chatwoot có `data_url` → tải về file tạm rồi truyền đường dẫn vào `attachments`.
4. Xác minh chữ ký webhook bằng secret **của từng API inbox** (mỗi inbox có secret riêng) trước khi xử lý: `X-Chatwoot-Signature: sha256=HMAC_SHA256(secret, "<X-Chatwoot-Timestamp>.<raw body>")`.
5. Trả HTTP ngay (timeout webhook của Chatwoot là 5s), gửi Zalo chạy nền, rồi cập nhật trạng thái tin bằng `PATCH /conversations/{id}/messages/{message_id}` với `status: "delivered" | "failed"` và `external_error` (chỉ dùng được cho API inbox). **Chatwoot không gửi lại webhook của API inbox khi lỗi**, nên mọi lỗi phải đánh dấu `failed` để nhân viên thấy.

> Shape payload/response trong code lấy từ source Chatwoot v4.18 (`lib/webhooks/trigger.rb`, `app/models/message.rb#webhook_data`, `app/views/api/v1/...`). Khi nâng version Chatwoot hoặc cần field mới, đọc lại source trong container (`docker compose exec rails sh`), đừng đoán.

### Mapping store
Database `zalo_bridge` (cùng server Postgres với Chatwoot nhưng tách database, không ghi vào DB của Chatwoot), dùng Drizzle ORM:
- `zalo_accounts`: `own_id`, tên hiển thị, `chatwoot_inbox_id`, webhook secret, proxy, trạng thái, credentials (mã hóa).
- `threads`: `(own_id, zalo_thread_id)` ↔ `chatwoot_contact_id`, `chatwoot_source_id`, `chatwoot_conversation_id`, `thread_type`.
- Mỗi thread Zalo dùng **một conversation cố định**: tin incoming vào conversation đã resolve thì Chatwoot tự mở lại. Nếu conversation bị xóa (404) thì tạo mới và cập nhật mapping.
- Xử lý tin theo `KeyedQueue` (tuần tự theo thread/conversation) để giữ thứ tự và không tạo trùng contact/conversation.

## Nhiều tài khoản Zalo

- **Mỗi tài khoản = một instance `new Zalo({...})` riêng** (để có proxy riêng qua option `agent`) và một `api` riêng. Quản lý tập trung trong `AccountManager`, key theo `api.getOwnId()`.
- **Mỗi tài khoản Zalo ↔ một API channel inbox** trên Chatwoot (đặt tên VD `Zalo - <tên tài khoản>`) để nhân viên biết tin đến từ số nào, và để định tuyến tin trả lời đúng tài khoản. Khi thêm tài khoản, có thể tạo inbox tự động qua Chatwoot API.
- **Thêm tài khoản**: nút "Thêm tài khoản Zalo" trên trang `/admin` → `QrLoginManager` gọi `zalo.loginQR({}, callback)` và trả ảnh QR (base64) cho trang hiển thị, không ghi file. Khi có callback, zca-js không tự lưu file QR, và khi `QRCodeExpired`/`QRCodeDeclined` phải tự gọi `actions.abort()`/`retry()`, nếu không promise sẽ treo. Sau khi đăng nhập: lưu cookie/imei/userAgent (`snapshotCredentials`) mã hóa vào DB, tài khoản mới thì tạo API inbox, rồi `AccountManager.connectAccount()` kết nối ngay, không cần khởi động lại.
- **Gỡ tài khoản = xóa inbox Zalo trên Chatwoot** (giống ngắt kết nối kênh Facebook). Chatwoot không có webhook `inbox_deleted`, nên `bridge/inbox-sync.ts` đối chiếu `GET /inboxes` lúc khởi động và mỗi 60s: tài khoản có inbox không còn tồn tại thì ngắt listener và xóa khỏi DB (credentials + threads). Đọc danh sách tài khoản **trước** khi lấy danh sách inbox để không xóa nhầm tài khoản vừa thêm; lấy danh sách inbox lỗi thì không xóa gì. Phiên Zalo Web vẫn còn trong danh sách thiết bị của app Zalo, người dùng tự đăng xuất trên điện thoại nếu muốn.
- **Khởi động lại**: đăng nhập lại tất cả tài khoản bằng cookie (`zalo.login({ cookie, imei, userAgent })`), lần lượt từng tài khoản, không đăng nhập ồ ạt cùng lúc.
- **Cô lập lỗi**: một tài khoản lỗi/mất kết nối không được làm ảnh hưởng tài khoản khác hay làm crash process. Theo dõi trạng thái từng tài khoản (`online`, `disconnected`, `needs_relogin`), tự reconnect có backoff, và cảnh báo khi cần quét QR lại.
- **Proxy**: trên Node.js dùng `agent: new HttpProxyAgent(url)` kèm `polyfill: nodefetch` (fetch gốc của Node không hỗ trợ proxy). Nên dùng mỗi tài khoản một IP để giảm rủi ro bị khóa.
- **Rate limit/queue gửi tin theo từng tài khoản.**

## AI agent trực tin nhắn (khi không có nhân viên)

Dùng cơ chế **Agent Bot** của Chatwoot: bot được gắn vào inbox, nhận webhook và trả lời qua API. Vì bot trả lời bằng tin `outgoing` bình thường, nên **chạy được cho cả Facebook, Instagram và Zalo** mà không cần code riêng từng kênh.

### Cơ chế Chatwoot
- Tạo Agent Bot (`POST /api/v1/accounts/{account_id}/agent_bots` hoặc trong Settings/Super Admin) với `outgoing_url` trỏ về service, rồi gắn bot vào từng inbox.
- Khi inbox có bot, conversation mới ở trạng thái **`pending`** → bot xử lý.
- Bot gửi trả lời: `POST /conversations/{id}/messages` với `message_type: "outgoing"`, dùng **access token của bot** (không dùng token nhân viên).
- **Chuyển giao cho người (handoff)**: `POST /conversations/{id}/toggle_status` với `status: "open"` (có thể kèm ghi chú nội bộ tóm tắt yêu cầu khách). Sau khi `open`, bot **không được trả lời** conversation đó nữa.
- Các endpoint trên viết theo trí nhớ, cần đối chiếu tài liệu Chatwoot trước khi code.

### Khi nào bot trả lời (cấu hình được, mặc định = kết hợp)
1. Ngoài giờ làm việc (theo working hours của inbox trong Chatwoot).
2. Không có nhân viên online (`GET /api/v1/accounts/{account_id}/agents` → `availability_status`).
3. Khách chờ quá N phút mà chưa có nhân viên trả lời.

Khi đang trong giờ làm và có nhân viên online → bot handoff ngay (hoặc chỉ gửi lời chào), không tự trả lời.

### Quy tắc cho bot
- Chống vòng lặp: bỏ qua mọi event không phải tin `incoming` của khách (tin của chính bot, của nhân viên, ghi chú nội bộ).
- Chỉ trả lời dựa trên **knowledge base** trong `knowledge/` đưa vào prompt. Không bịa giá, chính sách, không xác nhận đơn hàng/thanh toán.
- Handoff khi: khách yêu cầu gặp người, khiếu nại/bức xúc, câu hỏi ngoài knowledge base, liên quan tiền/đơn hàng, hoặc bot không chắc chắn.
- Nói rõ với khách đây là trợ lý tự động và nhân viên sẽ liên hệ lại trong giờ làm việc.
- Lấy lịch sử hội thoại từ Chatwoot (`GET /conversations/{id}/messages`) làm context, không tự lưu bản sao riêng.
- Trả lời bằng tiếng Việt, ngắn gọn, phù hợp chat (không dùng markdown phức tạp vì Zalo/Messenger không render).

### LLM
- Dùng Claude qua SDK chính thức `@anthropic-ai/sdk`, model mặc định `claude-opus-5-5` (chat ngắn → `output_config.effort: "low"`). Đọc tài liệu SDK/skill `claude-api` trước khi viết code gọi API, không đoán tham số.
- Kiểm tra `stop_reason` (đặc biệt `refusal`) trước khi đọc nội dung. Lỗi hoặc refusal → handoff thay vì im lặng.
- Dùng prompt caching cho phần system prompt + knowledge base (phần ổn định đặt trước).

## Ràng buộc quan trọng của zca-js

- **Thư viện không chính thức**, vi phạm chính sách Zalo → **tài khoản có thể bị khóa**. Nên dùng tài khoản riêng cho doanh nghiệp, giới hạn tốc độ gửi, không gửi spam hàng loạt.
- **Mỗi tài khoản chỉ có một web listener tại một thời điểm.** Mở Zalo Web trên trình duyệt sẽ làm listener của bridge bị ngắt → phải phát hiện mất kết nối, reconnect và cảnh báo. Dặn nhân viên không mở Zalo Web cho các tài khoản đã nối vào bridge.
- Khởi tạo: `new Zalo({ selfListen: false, checkUpdate: true, logging: true })`, sau khi đăng nhập phải gọi `api.listener.start()`.
- Credentials Zalo (cookie/imei/userAgent) là **bí mật** (tương đương mật khẩu): lưu mã hóa, không log, không commit.
- Listener khác: `reaction`, `undo`, `group_event`. Có thể map `undo` sang việc đánh dấu tin trên Chatwoot sau này.
- Tài liệu: thêm `.md` vào cuối URL trang GitBook để đọc dạng Markdown, mục lục ở `https://tdung.gitbook.io/zca-js/llms.txt`. Luôn tra type definitions trong `node_modules/zca-js` trước khi dùng API, vì API thay đổi theo phiên bản.

## Chatwoot

- Chạy bằng Docker Compose trong `infra/chatwoot/` (Rails + Sidekiq + Postgres + Redis), dùng image chính thức và **pin version** (đang dùng `v4.18.0`, không dùng `latest`). Database của Chatwoot là `chatwoot_production`.
- Dev local: Chatwoot ở http://localhost:3100, Postgres ở `localhost:5433` (máy dev đã có service khác chiếm 3000/5432). Biến cổng host tên `*_HOST_PORT`. **Không đặt `POSTGRES_PORT` trong `.env`**, vì Chatwoot đọc biến này làm cổng kết nối DB bên trong mạng Docker.
- `SAFE_FETCH_ALLOW_PRIVATE_NETWORK=true` là bắt buộc: Chatwoot mặc định chặn webhook tới IP nội bộ (SSRF filter), mà bridge chạy cùng máy/mạng Docker. Khi dev, bridge chạy trên host và Chatwoot gọi qua `http://host.docker.internal:3200`. **Không thêm `extra_hosts: host-gateway`** vào compose: nó thêm bản ghi IPv6, Ruby chọn IPv6 trước và webhook lỗi "Network unreachable" (tin hiện "Failed to send"). Kiểm tra kết nối bằng đúng HTTP client của Chatwoot: `docker compose exec sidekiq bundle exec rails runner 'SafeFetch.fetch("http://host.docker.internal:3200/health", validate_content_type: false) { |r| puts r.tempfile.read }'`. Ở production trên Linux, chạy bridge trong cùng Docker network và gọi bằng tên service.
- Facebook/Instagram cần Meta App: `FB_APP_ID`, `FB_APP_SECRET`, `FB_VERIFY_TOKEN`, `IG_VERIFY_TOKEN`. Ở các bản Chatwoot mới, các giá trị này cấu hình trong `/super_admin` → Installation Config. Meta yêu cầu domain **HTTPS** công khai. Khi dev local dùng tunnel (cloudflared/ngrok).
- Quyền nhắn tin của Meta App (Messenger, Instagram) cần **App Review** mới dùng được với khách thật. Nộp sớm vì có thể mất vài ngày đến vài tuần.
- Zalo dùng **API channel inbox** (mỗi tài khoản Zalo một inbox), callback URL trỏ tới webhook của zalo-bridge.
- Bridge gọi API bằng header `api_access_token` của **một user Chatwoot riêng cho bridge có quyền Administrator** (cần để tạo inbox và đọc `secret` của inbox; không dùng tài khoản cá nhân của ai). Inbox tạo qua API chưa có nhân viên nào: phải thêm collaborator trong Settings → Inboxes.
- Tài liệu: https://developers.chatwoot.com

## Lộ trình

Ưu tiên theo thứ tự:

1. **Chatwoot**: dựng bằng Docker Compose, tạo account/nhân viên, có domain HTTPS (hoặc tunnel khi dev).
2. **zalo-bridge MVP (1 tài khoản)**: đăng nhập QR, lưu session, nhận/gửi tin văn bản 1-1 qua API inbox.
3. **Nhiều tài khoản**: AccountManager, inbox riêng mỗi tài khoản, proxy, reconnect, trạng thái và cảnh báo.
4. **Ảnh, file và nhóm**: attachment hai chiều, tin nhắn nhóm (reaction/undo nếu kịp).
5. **AI agent**: Agent Bot, điều kiện kích hoạt, knowledge base, handoff.
6. **Production**: deploy VPS, HTTPS, backup Postgres, giám sát.

Facebook + Instagram không nằm trong lộ trình code: chỉ là cấu hình có sẵn của Chatwoot (Meta App, kết nối Page/IG, App Review).

## Quy ước code (zalo-bridge)

- Node.js (LTS) + TypeScript, ESM (`import`), vì zca-js là ESM và có sẵn type.
- Cấu hình qua biến môi trường, có `.env.example` (không commit `.env`, cookie hay file credentials). Biến dự kiến: `CHATWOOT_BASE_URL`, `CHATWOOT_ACCOUNT_ID`, `CHATWOOT_API_TOKEN`, `CHATWOOT_BOT_TOKEN`, `DATABASE_URL`, `CREDENTIALS_ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `PORT`. Cấu hình riêng từng tài khoản Zalo (inbox, secret, proxy) nằm trong DB, không nằm trong env.
- Mọi handler phải idempotent và không làm crash process: bắt lỗi từng tin nhắn, log kèm `ownId`/`threadId`/`conversation_id`, không log nội dung nhạy cảm hay credentials.
- Tiếng Việt có dấu: đảm bảo UTF-8 xuyên suốt.

## Lệnh thường dùng

Chatwoot (`cd infra/chatwoot`):
```bash
./init-env.sh                                                  # lần đầu: tạo .env với secret ngẫu nhiên
docker compose up -d postgres redis
docker compose run --rm rails bundle exec rails db:chatwoot_prepare   # lần đầu / sau khi nâng version
docker compose up -d                                           # chạy tất cả
docker compose logs -f rails sidekiq
curl http://localhost:3100/api                                 # kiểm tra version + trạng thái
```

zalo-bridge (`cd services/zalo-bridge`, cần `.env` từ `.env.example`):
```bash
pnpm install
pnpm dev            # chạy bridge (tsx watch), tự chạy migration khi khởi động
pnpm typecheck
pnpm db:generate    # sau khi sửa src/store/schema.ts: sinh migration mới trong drizzle/
pnpm db:migrate
open http://localhost:3200/admin    # quản trị (cần đang đăng nhập Chatwoot bằng admin): quét QR, trạng thái, kết nối lại
curl http://127.0.0.1:3200/health   # số tài khoản / số đang online
```

Chưa có test tự động và lint.

Ghi chú:
- zca-js 2.2.0 có `index.d.ts` gốc lỗi với `moduleResolution: NodeNext`, nên `tsconfig.json` dùng `paths` trỏ về `dist/index.d.ts`. Khi nâng zca-js, kiểm tra lại và bỏ workaround nếu đã sửa.
- Trang `/admin` không có mật khẩu riêng: đọc cookie `cw_d_session_info` của dashboard Chatwoot (header devise_token_auth `access-token`/`client`/`uid`), gọi `GET /api/v1/profile` để kiểm tra user là **administrator** của `CHATWOOT_ACCOUNT_ID` (cache 60s). Vì vậy trang phải **cùng host với Chatwoot**: dev mở `http://localhost:3200/admin` (không dùng 127.0.0.1), production đặt dưới cùng domain qua reverse proxy. POST yêu cầu header `x-requested-with: zalo-admin` (chống CSRF).
- **Kênh "Zalo" trong Add Inbox** (Settings → Inboxes → Add Inbox): Installation Config `DASHBOARD_SCRIPTS` = `<script src="http://localhost:3200/chatwoot/zalo-channel.js"></script>` (đặt qua Super Admin → Settings hoặc `rails runner` + `GlobalConfig.clear_cache`). Script (`src/admin/chatwoot-script.ts`) clone thẻ API trong lưới `.grid > button` thành thẻ "Zalo", bấm vào mở popup iframe `/admin?connect` (QR); quét xong trang popup `postMessage` `zalo:connected` về Chatwoot và chuyển tới `/settings/inboxes/new/<inboxId>/agents` (bước thêm nhân viên có sẵn). Script dựa vào DOM Chatwoot v4.18 (`ChannelList.vue`, `ChannelSelector.vue`): khi nâng version phải kiểm tra lại thẻ Zalo còn hiện. Inbox vẫn hiện icon API (đổi icon cần fork). Lên production phải sửa URL script.
- Trang admin được nhúng vào Chatwoot làm **Dashboard App "Zalo"** (Settings → Integrations → Dashboard Apps, URL `http://localhost:3200/admin`): hiện thành tab trong màn hình cuộc chat. Lên production phải sửa URL này.
- Không đặt script tên `login` trong package.json: `pnpm login` là lệnh có sẵn của pnpm (đăng nhập npm).
- pnpm 11 chặn build script mặc định: `pnpm-workspace.yaml` đã cho phép `esbuild` (cần cho tsx).
