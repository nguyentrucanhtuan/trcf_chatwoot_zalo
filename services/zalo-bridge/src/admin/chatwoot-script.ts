// Script chèn vào dashboard Chatwoot qua Installation Config `DASHBOARD_SCRIPTS`
// (<script src="<bridge>/chatwoot/zalo-channel.js"></script>), không cần fork Chatwoot.
// Thêm thẻ "Zalo" vào trang Add Inbox; bấm vào mở popup QR (trang /admin?connect của bridge),
// quét xong chuyển sang bước thêm nhân viên giống luồng tạo kênh có sẵn.
// Dựa vào DOM của Chatwoot v4.18 (ChannelList.vue / ChannelSelector.vue): nếu nâng version mà không tìm
// thấy thẻ mẫu thì script chỉ không chèn gì, không làm hỏng trang.
export const chatwootDashboardScript = /* js */ `(() => {
  if (window.__zaloChannelScript) return;
  window.__zaloChannelScript = true;

  const BRIDGE = new URL(document.currentScript.src).origin;
  const ADD_INBOX_PATH = /^\\/app\\/accounts\\/(\\d+)\\/settings\\/inboxes\\/new\\/?$/;
  // Chỉ tìm trong lưới thẻ kênh (sidebar cũng có icon .i-woot-api của các inbox API).
  // Thẻ API luôn bật nên dùng làm mẫu (thẻ Facebook/Instagram bị mờ khi chưa cấu hình Meta App).
  const TEMPLATE_ICON = ".grid > button .i-woot-api";
  const INSTAGRAM_ICON = ".grid > button .i-woot-instagram";
  let accountId = null;

  function zaloIcon() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "24");
    svg.setAttribute("height", "24");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML =
      '<path fill="#0068FF" d="M12 2C6.48 2 2 5.92 2 10.75c0 2.6 1.3 4.93 3.36 6.53L4.5 21.5l4.3-2.2c1 .28 2.07.45 3.2.45 5.52 0 10-3.92 10-8.75S17.52 2 12 2z"/>' +
      '<text x="12" y="13.8" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="7.5" font-weight="700" fill="#fff">Zalo</text>';
    return svg;
  }

  function injectCard() {
    const match = location.pathname.match(ADD_INBOX_PATH);
    if (!match || document.querySelector("[data-zalo-channel]")) return;
    const templateIcon = document.querySelector(TEMPLATE_ICON);
    const template = templateIcon && templateIcon.closest("button");
    if (!template) return;

    const card = template.cloneNode(true);
    card.setAttribute("data-zalo-channel", "");
    card.disabled = false;
    const title = card.querySelector("h3");
    const description = card.querySelector("p");
    if (title) title.textContent = "Zalo";
    if (description) description.textContent = "Kết nối tài khoản Zalo cá nhân bằng mã QR";
    const icon = card.querySelector(".i-woot-api");
    if (icon) icon.replaceWith(zaloIcon());
    card.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openConnect(match[1]);
    });
    // Đặt cạnh Instagram cho dễ thấy; không có thì để cuối danh sách.
    const instagram = document.querySelector(INSTAGRAM_ICON);
    const anchor = instagram && instagram.closest("button");
    if (anchor) anchor.after(card);
    else template.parentElement.append(card);
  }

  function closeConnect() {
    const overlay = document.getElementById("zalo-connect-overlay");
    if (overlay) overlay.remove();
  }

  function openConnect(id) {
    closeConnect();
    accountId = id;
    const overlay = document.createElement("div");
    overlay.id = "zalo-connect-overlay";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px";
    const frame = document.createElement("iframe");
    frame.src = BRIDGE + "/admin?connect";
    frame.title = "Kết nối Zalo";
    frame.style.cssText =
      "width:min(420px,100%);height:min(620px,100%);border:0;border-radius:14px;box-shadow:0 20px 50px rgba(0,0,0,.3)";
    overlay.append(frame);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeConnect();
    });
    document.body.append(overlay);
  }

  window.addEventListener("message", (event) => {
    if (event.origin !== BRIDGE || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "zalo:close") closeConnect();
    if (event.data.type === "zalo:connected" && accountId) {
      const inboxId = Number(event.data.inboxId);
      if (!Number.isInteger(inboxId)) return;
      const base = "/app/accounts/" + accountId + "/settings/inboxes";
      // Tải lại trang để Chatwoot nạp inbox mới vào store.
      const target = event.data.created ? base + "/new/" + inboxId + "/agents" : base + "/" + inboxId;
      setTimeout(() => location.assign(target), 1200);
    }
  });

  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      injectCard();
    });
  }).observe(document.body, { childList: true, subtree: true });
  injectCard();
})();
`;
