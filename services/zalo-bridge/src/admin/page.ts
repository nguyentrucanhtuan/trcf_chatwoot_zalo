import { config } from "../config.js";

// Trang admin một file: HTML + CSS + JS thuần, không build step.
// Dữ liệu từ Zalo (tên hiển thị) chỉ được gán qua textContent để tránh XSS.

const chatwootUrl = config.CHATWOOT_PUBLIC_URL ?? config.CHATWOOT_BASE_URL;

/** Trang hiện khi chưa có phiên Chatwoot hợp lệ, hoặc user không phải Administrator. */
export function loginRequiredPage(reason: "unauthenticated" | "forbidden"): string {
  const message =
    reason === "forbidden"
      ? "Chỉ tài khoản Administrator của Chatwoot mới quản lý được tài khoản Zalo."
      : "Bạn cần đăng nhập Chatwoot trước khi quản lý tài khoản Zalo.";
  return /* html */ `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zalo Bridge</title>
<style>
  :root { --bg: #f6f7f9; --text: #1d2330; --muted: #6b7280; --primary: #0068ff; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f1218; --text: #e5e7eb; --muted: #9ca3af; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text);
         font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { max-width: 420px; text-align: center; }
  a { display: inline-block; margin-top: 12px; background: var(--primary); color: #fff; padding: 8px 16px;
      border-radius: 8px; text-decoration: none; font-weight: 600; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 20px; }
</style></head>
<body><main>
  <h1 style="font-size:20px">Tài khoản Zalo</h1>
  <p>${message}</p>
  ${reason === "unauthenticated" ? `<a href="${chatwootUrl}/app/login" target="_top">Đăng nhập Chatwoot</a>` : ""}
  <p class="hint">Trang này phải mở cùng tên miền với Chatwoot (khi dev: dùng <b>localhost</b>, không dùng 127.0.0.1).</p>
</main></body></html>`;
}

export const adminPage = /* html */ `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Zalo Bridge</title>
<style>
  :root {
    --bg: #f6f7f9; --card: #fff; --text: #1d2330; --muted: #6b7280; --border: #e5e7eb;
    --primary: #0068ff; --primary-text: #fff;
    --ok: #15803d; --ok-bg: #dcfce7; --warn: #a16207; --warn-bg: #fef9c3;
    --bad: #b91c1c; --bad-bg: #fee2e2; --idle: #4b5563; --idle-bg: #f3f4f6;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1218; --card: #171b23; --text: #e5e7eb; --muted: #9ca3af; --border: #2a303c;
      --ok: #4ade80; --ok-bg: #14301f; --warn: #facc15; --warn-bg: #33290b;
      --bad: #f87171; --bad-bg: #3a1414; --idle: #d1d5db; --idle-bg: #262b35;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 32px 16px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
  h1 { font-size: 22px; margin: 0; }
  .sub { color: var(--muted); font-size: 14px; margin: 2px 0 0; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 12px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  th { font-size: 13px; font-weight: 600; color: var(--muted); }
  tr:last-child td { border-bottom: 0; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 13px; color: var(--muted); }
  .empty { padding: 40px 16px; text-align: center; color: var(--muted); }
  button { font: inherit; border-radius: 8px; padding: 8px 14px; cursor: pointer; border: 1px solid var(--border); background: var(--card); color: var(--text); }
  button.primary { background: var(--primary); border-color: var(--primary); color: var(--primary-text); font-weight: 600; }
  button:disabled { opacity: .6; cursor: default; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 500; white-space: nowrap; }
  .b-ok { color: var(--ok); background: var(--ok-bg); }
  .b-warn { color: var(--warn); background: var(--warn-bg); }
  .b-bad { color: var(--bad); background: var(--bad-bg); }
  .b-idle { color: var(--idle); background: var(--idle-bg); }
  dialog { border: 1px solid var(--border); border-radius: 14px; background: var(--card); color: var(--text); padding: 24px; width: min(380px, calc(100vw - 32px)); }
  dialog::backdrop { background: rgb(0 0 0 / .45); }
  dialog h2 { font-size: 18px; margin: 0 0 4px; }
  .qr-box { display: grid; place-items: center; width: 100%; aspect-ratio: 1; margin: 16px 0; border-radius: 10px; background: #fff; border: 1px solid var(--border); }
  .qr-box img { width: 88%; height: auto; image-rendering: pixelated; }
  .qr-box .msg { color: #374151; padding: 16px; text-align: center; font-size: 15px; }
  .status { min-height: 44px; margin: 0 0 16px; }
  .actions { display: flex; gap: 8px; justify-content: flex-end; }
  .err { color: var(--bad); font-size: 14px; }
  @media (max-width: 600px) { .hide-sm { display: none; } th, td { padding: 10px 12px; } }
  /* ?connect: nằm trong iframe popup của Chatwoot, dialog phủ kín iframe */
  html.connect body { background: var(--card); }
  html.connect dialog { border: 0; border-radius: 0; margin: 0; width: 100%; max-width: 100%; height: 100%; max-height: 100%; }
  html.connect dialog::backdrop { background: transparent; }
</style>
</head>
<body>
<main>
  <header>
    <div>
      <h1>Tài khoản Zalo</h1>
      <p class="sub">Mỗi tài khoản Zalo là một inbox trên Chatwoot. <span id="me"></span></p>
    </div>
    <button class="primary" id="add">+ Thêm tài khoản Zalo</button>
  </header>
  <div class="card">
    <table>
      <thead><tr><th>Tài khoản</th><th class="hide-sm">Inbox Chatwoot</th><th>Trạng thái</th><th></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div class="empty" id="empty" hidden>Chưa có tài khoản nào. Bấm “Thêm tài khoản Zalo” để quét QR.</div>
  </div>
  <p class="err" id="list-error"></p>
</main>

<dialog id="qr-dialog">
  <h2>Quét mã bằng app Zalo</h2>
  <p class="sub">Mở Zalo trên điện thoại → biểu tượng quét QR → quét mã bên dưới.</p>
  <div class="qr-box" id="qr-box"></div>
  <p class="status" id="qr-status"></p>
  <div class="actions">
    <button id="qr-retry" hidden>Tạo mã mới</button>
    <button id="qr-close">Đóng</button>
  </div>
</dialog>

<script>
// ?connect: chế độ popup khi bấm thẻ "Zalo" ở trang Add Inbox của Chatwoot (xem chatwoot-script.ts).
const CONNECT_MODE = new URLSearchParams(location.search).has("connect");
const PARENT_ORIGIN = ${JSON.stringify(new URL(chatwootUrl).origin)};
function notifyParent(message) {
  if (window.parent !== window) window.parent.postMessage(message, PARENT_ORIGIN);
}

const STATUS = {
  online: ["Đang hoạt động", "b-ok"],
  connecting: ["Đang kết nối", "b-warn"],
  offline: ["Mất kết nối, đang thử lại", "b-idle"],
  duplicate_connection: ["Bị ngắt do mở Zalo Web nơi khác", "b-bad"],
  needs_relogin: ["Cần quét QR lại", "b-bad"],
};
const QR_TEXT = {
  starting: "Đang tạo mã QR...",
  waiting_scan: "Đang chờ quét mã. Mã hết hạn sau khoảng 100 giây.",
  waiting_confirm: "Đã quét. Bấm “Đăng nhập” trên điện thoại để xác nhận.",
  expired: "Mã QR đã hết hạn.",
  declined: "Đăng nhập bị từ chối trên điện thoại.",
  cancelled: "Đã hủy.",
};

const $ = (id) => document.getElementById(id);
function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}
async function api(path, options = {}) {
  const res = await fetch("/admin/api" + path, {
    ...options,
    credentials: "same-origin",
    headers: { "x-requested-with": "zalo-admin" },
  });
  // Phiên Chatwoot hết hạn: tải lại để hiện trang đăng nhập.
  if (res.status === 401) { location.reload(); throw new Error("Phiên đăng nhập Chatwoot đã hết hạn"); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function loadAccounts() {
  try {
    const accounts = await api("/accounts");
    $("list-error").textContent = "";
    $("empty").hidden = accounts.length > 0;
    $("rows").replaceChildren(...accounts.map(renderRow));
  } catch (e) {
    $("list-error").textContent = "Không tải được danh sách: " + e.message;
  }
}

function renderRow(a) {
  const [label, cls] = STATUS[a.status] || [a.status, "b-idle"];
  const actions = el("td", { style: "text-align:right" });
  if (a.status === "needs_relogin") {
    actions.append(el("button", { textContent: "Quét QR lại", onclick: startQr }));
  } else if (a.status !== "online" && a.status !== "connecting") {
    actions.append(el("button", { textContent: "Kết nối lại", onclick: (ev) => reconnect(a.ownId, ev.target) }));
  }
  return el("tr", {}, [
    el("td", {}, [el("div", { textContent: a.displayName }), el("div", { className: "mono", textContent: a.ownId })]),
    el("td", { className: "hide-sm mono", textContent: "#" + a.chatwootInboxId }),
    el("td", {}, [el("span", { className: "badge " + cls, textContent: label })]),
    actions,
  ]);
}

async function reconnect(ownId, button) {
  button.disabled = true;
  try { await api("/accounts/" + ownId + "/reconnect", { method: "POST" }); }
  catch (e) { alert("Kết nối lại thất bại: " + e.message); }
  loadAccounts();
}

let qrId = null;
let qrTimer = null;

async function startQr() {
  $("qr-dialog").showModal();
  renderQr({ state: "starting" });
  try {
    const view = await api("/qr-logins", { method: "POST" });
    qrId = view.id;
    pollQr();
  } catch (e) {
    renderQr({ state: "error", error: e.message });
  }
}

async function pollQr() {
  clearTimeout(qrTimer);
  if (!qrId) return;
  try {
    const view = await api("/qr-logins/" + qrId);
    renderQr(view);
    if (["success", "expired", "declined", "cancelled", "error"].includes(view.state)) {
      if (view.state === "success") {
        notifyParent({ type: "zalo:connected", inboxId: view.inboxId, created: view.created, displayName: view.displayName });
      }
      if (!CONNECT_MODE) loadAccounts();
      return;
    }
  } catch (e) {
    renderQr({ state: "error", error: e.message });
    return;
  }
  qrTimer = setTimeout(pollQr, 1500);
}

function renderQr(view) {
  const box = $("qr-box");
  if (view.qrImage) {
    const img = box.querySelector("img");
    if (img) img.src = view.qrImage;
    else box.replaceChildren(el("img", { src: view.qrImage, alt: "Mã QR đăng nhập Zalo" }));
  } else {
    let msg = QR_TEXT[view.state] || "";
    if (view.state === "success") msg = "✓ " + (view.created ? "Đã thêm" : "Đã đăng nhập lại") + " “" + (view.displayName || view.ownId) + "”";
    if (view.state === "error") msg = "Lỗi: " + (view.error || "không rõ");
    box.replaceChildren(el("div", { className: "msg", textContent: msg }));
  }
  let status = QR_TEXT[view.state] || "";
  if (view.state === "success") status = view.created
    ? "Đã tạo inbox mới trên Chatwoot. Nhớ thêm nhân viên vào inbox (Settings → Inboxes → Collaborators)."
    : "Đã cập nhật phiên đăng nhập và kết nối lại.";
  if (view.state === "error") status = "";
  $("qr-status").textContent = status;
  $("qr-retry").hidden = !["expired", "declined", "error", "cancelled"].includes(view.state);
}

function closeQr() {
  clearTimeout(qrTimer);
  if (qrId) api("/qr-logins/" + qrId + "/cancel", { method: "POST" }).catch(() => {});
  qrId = null;
  $("qr-dialog").close();
  notifyParent({ type: "zalo:close" });
}

$("add").onclick = startQr;
$("qr-retry").onclick = startQr;
$("qr-close").onclick = closeQr;
$("qr-dialog").addEventListener("cancel", (ev) => { ev.preventDefault(); closeQr(); });

if (CONNECT_MODE) {
  document.documentElement.classList.add("connect");
  document.querySelector("main").hidden = true;
  startQr();
} else {
  api("/me").then((me) => { $("me").textContent = "Đăng nhập: " + me.name; }).catch(() => {});
  loadAccounts();
  setInterval(loadAccounts, 5000);
}
</script>
</body>
</html>`;
