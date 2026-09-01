// =========================================================
// NOTIFY.JS — Toast & Modal kustom (pengganti alert/confirm/prompt)
// =========================================================

(function () {
  const root = document.createElement("div");
  root.id = "notify-root";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(root));

  const ICONS = {
    success: "✓",
    error: "✕",
    warning: "!",
    info: "i"
  };

  // ---------------- TOAST ----------------
  function toast(message, type = "info", duration = 4200) {
    ensureContainers();
    const el = document.createElement("div");
    el.className = `nx-toast nx-${type}`;
    el.innerHTML = `
      <div class="nx-toast-icon">${ICONS[type] || ICONS.info}</div>
      <div class="nx-toast-msg">${message}</div>
      <button class="nx-toast-close" aria-label="Tutup">&times;</button>
      <div class="nx-toast-bar"><div class="nx-toast-bar-fill"></div></div>
    `;
    document.getElementById("nx-toast-stack").appendChild(el);
    requestAnimationFrame(() => el.classList.add("nx-in"));

    const fill = el.querySelector(".nx-toast-bar-fill");
    fill.style.animationDuration = duration + "ms";

    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      el.classList.remove("nx-in");
      el.classList.add("nx-out");
      setTimeout(() => el.remove(), 260);
    };
    el.querySelector(".nx-toast-close").addEventListener("click", remove);
    const timer = setTimeout(remove, duration);
    el.addEventListener("mouseenter", () => { clearTimeout(timer); fill.style.animationPlayState = "paused"; });
  }

  // ---------------- CONFIRM MODAL ----------------
  function confirmModal(message, opts = {}) {
    ensureContainers();
    const {
      title = "Konfirmasi",
      confirmText = "Ya, Lanjutkan",
      cancelText = "Batal",
      danger = false
    } = opts;

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "nx-overlay";
      overlay.innerHTML = `
        <div class="nx-modal nx-modal-sm">
          <div class="nx-modal-icon ${danger ? "nx-danger-icon" : "nx-info-icon"}">${danger ? "!" : "?"}</div>
          <h3 class="nx-modal-title">${title}</h3>
          <p class="nx-modal-msg">${message}</p>
          <div class="nx-modal-actions">
            <button class="btn btn-ghost nx-btn-cancel">${cancelText}</button>
            <button class="btn ${danger ? "btn-danger" : "btn-primary"} nx-btn-confirm">${confirmText}</button>
          </div>
        </div>
      `;
      document.getElementById("notify-root").appendChild(overlay);
      requestAnimationFrame(() => overlay.classList.add("nx-in"));

      const close = (result) => {
        overlay.classList.remove("nx-in");
        overlay.classList.add("nx-out");
        setTimeout(() => overlay.remove(), 220);
        resolve(result);
      };
      overlay.querySelector(".nx-btn-cancel").addEventListener("click", () => close(false));
      overlay.querySelector(".nx-btn-confirm").addEventListener("click", () => close(true));
      overlay.addEventListener("click", (e) => { if (e.target === overlay) close(false); });
      document.addEventListener("keydown", function esc(e) {
        if (e.key === "Escape") { close(false); document.removeEventListener("keydown", esc); }
      });
    });
  }

  // ---------------- GENERIC FORM MODAL ----------------
  // opts: { title, bodyHTML, confirmText, cancelText, onConfirm(container) -> bool|Promise<bool> (false = keep open) }
  function formModal(opts = {}) {
    ensureContainers();
    const {
      title = "",
      bodyHTML = "",
      confirmText = "Simpan",
      cancelText = "Batal",
      wide = false
    } = opts;

    const overlay = document.createElement("div");
    overlay.className = "nx-overlay";
    overlay.innerHTML = `
      <div class="nx-modal ${wide ? "nx-modal-lg" : ""}">
        <button class="nx-modal-x" aria-label="Tutup">&times;</button>
        <h3 class="nx-modal-title nx-modal-title-left">${title}</h3>
        <div class="nx-modal-body">${bodyHTML}</div>
        <div class="nx-modal-actions">
          <button class="btn btn-ghost nx-btn-cancel">${cancelText}</button>
          <button class="btn btn-primary nx-btn-confirm">${confirmText}</button>
        </div>
      </div>
    `;
    document.getElementById("notify-root").appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add("nx-in"));

    const container = overlay.querySelector(".nx-modal-body");
    const close = () => {
      overlay.classList.remove("nx-in");
      overlay.classList.add("nx-out");
      setTimeout(() => overlay.remove(), 220);
    };
    overlay.querySelector(".nx-modal-x").addEventListener("click", close);
    overlay.querySelector(".nx-btn-cancel").addEventListener("click", close);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });

    overlay.querySelector(".nx-btn-confirm").addEventListener("click", async () => {
      if (typeof opts.onConfirm === "function") {
        const result = await opts.onConfirm(container, close);
        if (result !== false) close();
      } else {
        close();
      }
    });

    return { close, container };
  }

  function ensureContainers() {
    let root2 = document.getElementById("notify-root");
    if (!root2) {
      root2 = document.createElement("div");
      root2.id = "notify-root";
      document.body.appendChild(root2);
    }
    if (!document.getElementById("nx-toast-stack")) {
      const stack = document.createElement("div");
      stack.id = "nx-toast-stack";
      root2.appendChild(stack);
    }
  }

  window.Notify = { toast, confirm: confirmModal, form: formModal };
})();
