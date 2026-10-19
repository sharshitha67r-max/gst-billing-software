import { state, $, $$, esc, icon, api, toast, empty } from "./core.js";
import {
  dashboard,
  masters,
  profile,
  history,
  invoiceDetail,
  payments,
  reports,
  settingsPage,
  importPage,
  backupPage,
  backupInitialization,
  auditPage,
  reminders,
} from "./pages.js";
import { invoiceEditor, clearBrowserDraft } from "./invoice.js";

const routes = [
  ["dashboard", "Dashboard", "/", "D"],
  ["invoice", "New invoice", "/invoices/new", "N"],
  ["history", "Invoice history", "/invoices", "H"],
  ["payments", "Payments", "/payments", "P"],
  ["reminders", "Reminders", "/reminders", "M"],
  ["customers", "Customers", "/customers", "C"],
  ["items", "Items", "/items", "I"],
  ["reports", "Reports", "/reports", "R"],
  ["upload", "Excel import", "/import", "X"],
  ["backup", "Backup / export", "/backup", "B"],
  ["settings", "Settings", "/settings", ""],
];
let routing = 0;

async function navigate(path, { replace = false, skipGuard = false } = {}) {
  if (!skipGuard && state.guard && !(await state.guard())) return;
  state.dispose?.();
  state.dispose = null;
  state.guard = null;
  state.hasUnsaved = null;
  state.invoiceKeys = null;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  await render();
}
state.navigate = navigate;

function shell() {
  const path = location.pathname;
  const active =
    routes.find((r) => r[2] === path) ||
    (path.startsWith("/invoices/")
      ? routes[2]
      : routes.find((r) => path.startsWith(r[2]) && r[2] !== "/"));
  $("#app").innerHTML =
    `<div class="layout"><aside class="sidebar"><div class="brand"><div class="brand-mark">S</div><div><strong>SVS ENTERPRISES</strong><small>GST BILLING</small></div></div><nav aria-label="Main navigation"><div class="nav-label">Workspace</div>${routes.map((r, i) => `${i === 5 ? '<div class="nav-label">Masters & insights</div>' : i === 9 ? '<div class="nav-label">Administration</div>' : ""}<a href="${r[2]}" class="nav-link ${r === active ? "active" : ""}" ${r === active ? 'aria-current="page"' : ""}>${icon(r[0])}<span>${r[1]}</span>${r[3] ? "<kbd>Alt " + r[3] + "</kbd>" : ""}</a>`).join("")}</nav><div class="sidebar-footer"><div class="owner-indicator"><span class="dot"></span>Owner workspace</div><div>GST-inclusive billing · INR</div><div>${esc([state.settings.city, state.settings.state].filter(Boolean).join(", "))}</div></div></aside><div class="workspace"><header class="topbar"><div class="crumb">SVS Enterprises<span>/</span><strong>${esc(active?.[1] || "Workspace")}</strong></div><div class="account"><span class="owner-email">${esc(state.owner.email)}</span><span class="avatar">SV</span><button id="logout" class="quiet small" aria-label="Sign out">${icon("logout")}Sign out</button></div></header><main class="content" id="main-content"><div class="loading">Loading workspace…</div></main></div>`;
  $("#logout").onclick = async () => {
    if (state.guard && !(await state.guard())) return;
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
      state.owner = null;
      state.guard = null;
      state.hasUnsaved = null;
      state.invoiceKeys = null;
      clearBrowserDraft();
      loginScreen();
    } catch (error) {
      toast(error.message, true);
    }
  };
  return $("#main-content");
}

async function render() {
  const route = ++routing;
  if (!state.owner) return loginScreen();
  const root = shell();
  try {
    const path = location.pathname;
    const params = new URLSearchParams(location.search);
    if (path === "/") await dashboard(root);
    else if (path === "/invoices/new") await invoiceEditor(root, null, params);
    else if (/^\/invoices\/[^/]+\/edit$/.test(path))
      await invoiceEditor(root, path.split("/")[2], params);
    else if (/^\/invoices\/[^/]+$/.test(path))
      await invoiceDetail(root, path.split("/")[2]);
    else if (path === "/invoices") await history(root);
    else if (path === "/customers" || path === "/items")
      await masters(root, path.slice(1));
    else if (/^\/(customers|items)\/[^/]+$/.test(path))
      await profile(root, path.split("/")[1], path.split("/")[2]);
    else if (path === "/payments") await payments(root);
    else if (path === "/reports") await reports(root);
    else if (path === "/settings") await settingsPage(root);
    else if (path === "/import") await importPage(root);
    else if (path === "/backup") {
      await backupPage(root);
      backupInitialization(root);
    } else if (path === "/audit") await auditPage(root);
    else if (path === "/reminders") await reminders(root);
    else
      root.innerHTML = empty(
        "Page not found",
        "Choose a module from the sidebar.",
      );
    if (route === routing) window.scrollTo(0, 0);
  } catch (error) {
    if (route !== routing) return;
    root.innerHTML = `<div class="inline-note error">${esc(error.message)}</div><button id="retry-page">Try again</button>`;
    $("#retry-page", root).onclick = render;
  }
}

async function loginScreen() {
  state.dispose?.();
  state.dispose = null;
  state.guard = null;
  state.hasUnsaved = null;
  state.invoiceKeys = null;
  $("#app").innerHTML =
    `<div class="login-layout"><section class="login-story"><div class="brand"><div class="brand-mark">S</div><div><strong>SVS ENTERPRISES</strong><small>GST-INCLUSIVE BILLING</small></div></div><h1>Your billing,<br>in good order.</h1><p>Tax invoices, payments and customer records.<br>One workspace for the way you do business.</p><div class="tax-rule"><div><strong>÷ 1.18</strong><span>TAXABLE VALUE</span></div><div><strong>9%</strong><span>CGST</span></div><div><strong>9%</strong><span>SGST</span></div></div><div class="foot">SVS ENTERPRISES<br>GST-inclusive owner console</div></section><section class="login-form-wrap"><form class="login-form" id="login-form"><div class="login-lock">${icon("lock")}</div><div class="eyebrow">OWNER CONSOLE</div><h2>Welcome back.</h2><p class="subtitle">Sign in to manage invoices and your business.</p><div id="setup-message"></div><div class="modal-error" id="login-error" role="alert"></div><label class="field"><span>Email</span><input name="email" type="email" autocomplete="username" placeholder="Your owner email address" required maxlength="254"></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required maxlength="256"></label><button class="primary" type="submit">Sign in ${icon("arrow")}</button><p class="login-footer">Owner access only.<br>Forgot your password? Use the server’s owner reset command.</p></form></section></div>`;
  try {
    const status = await api("/api/auth/status");
    if (!status.configured)
      $("#setup-message").innerHTML =
        '<div class="inline-note">The owner account has not been configured yet. Set OWNER_EMAIL and OWNER_PASSWORD in your hosting environment, or run the owner setup command in the deployment guide.</div>';
  } catch {}
  $("#login-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("[type=submit]", event.target);
    button.disabled = true;
    $("#login-error").textContent = "";
    try {
      state.owner = await api("/api/auth/login", {
        method: "POST",
        body: Object.fromEntries(new FormData(event.target)),
      });
      state.settings = await api("/api/settings");
      await render();
    } catch (error) {
      $("#login-error").textContent = error.message;
      button.disabled = false;
    }
  };
}

document.addEventListener("click", (event) => {
  const anchor = event.target.closest("a");
  if (
    !anchor ||
    event.defaultPrevented ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    anchor.target === "_blank" ||
    anchor.hasAttribute("download")
  )
    return;
  const href = anchor.getAttribute("href");
  if (
    !href ||
    href === "#" ||
    href.startsWith("/api/") ||
    !href.startsWith("/")
  )
    return;
  event.preventDefault();
  navigate(href);
});
window.addEventListener("popstate", () => {
  state.dispose?.();
  state.dispose = null;
  state.guard = null;
  state.hasUnsaved = null;
  state.invoiceKeys = null;
  render();
});
window.addEventListener("beforeunload", (event) => {
  if (state.hasUnsaved?.()) {
    event.preventDefault();
    event.returnValue = "";
  }
});
window.addEventListener("session-expired", () => {
  state.guard = null;
  state.hasUnsaved = null;
  state.invoiceKeys = null;
  loginScreen();
  toast("Session expired. Sign in again to continue.", true);
});
document.addEventListener("keydown", (event) => {
  if ($("#modal").open) return;
  if (state.invoiceKeys && (event.ctrlKey || event.metaKey))
    return state.invoiceKeys(event);
  if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "p" &&
    /^\/invoices\/[^/]+$/.test(location.pathname)
  ) {
    event.preventDefault();
    $("#print-invoice")?.click();
    return;
  }
  if (event.altKey && !event.ctrlKey && !event.metaKey) {
    const route = routes.find(
      (r) => r[3].toLowerCase() === event.key.toLowerCase(),
    );
    if (route) {
      event.preventDefault();
      navigate(route[2]);
    }
  }
});
window.addEventListener("unhandledrejection", (event) => {
  event.preventDefault();
  toast(
    event.reason?.message || "Something went wrong. Please try again.",
    true,
  );
});

try {
  state.owner = await api("/api/auth/me");
  state.settings = await api("/api/settings");
  await render();
} catch {
  await loginScreen();
}
