import { displayDate, parseDate } from "./dates.js";
export { displayDate, displayDateTime, reportDate } from "./dates.js";

export const state = {
  owner: null,
  settings: null,
  navigate: null,
  guard: null,
};
export const $ = (selector, parent = document) =>
  parent.querySelector(selector);
export const $$ = (selector, parent = document) => [
  ...parent.querySelectorAll(selector),
];
export const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const money = (value) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((value ?? 0) / 100);
export const amount = (value) => ((value ?? 0) / 100).toFixed(2);
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function dateInput(
  name,
  value = "",
  { id = "", label = "", required = false } = {},
) {
  return `<input type="text" class="date-input" data-date inputmode="numeric" name="${esc(name)}" ${id ? `id="${esc(id)}"` : ""} ${label ? `aria-label="${esc(label)}"` : ""} value="${value ? esc(displayDate(value)) : ""}" placeholder="dd/mm/yyyy" maxlength="10" pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" title="dd/mm/yyyy" ${required ? "required" : ""}>`;
}
export function dateValue(input) {
  try {
    const value = parseDate(input.value);
    if (!value && input.required) throw new Error("Enter a date as dd/mm/yyyy");
    input.setCustomValidity("");
    return value;
  } catch (error) {
    input.setCustomValidity(error.message);
    throw error;
  }
}
export function bindDates(parent, onValidInput = null) {
  $$("input[data-date]", parent).forEach((input) => {
    input.addEventListener("input", () => {
      try {
        dateValue(input);
        onValidInput?.();
      } catch {}
    });
  });
}
export const debounce = (fn, ms = 230) => {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
};
export const icon = (name) =>
  `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${{ dashboard: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>', invoice: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 12h7M9 16h7"/>', plus: '<path d="M12 5v14M5 12h14"/>', history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v6l4 2"/>', customers: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M17 15a5 5 0 0 1 4 5"/>', items: '<path d="M12 3 3 8v9l9 5 9-5V8zM3 8l9 5 9-5M12 13v9M7 5.5l9 5"/>', payments: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M6 15h4"/>', reports: '<path d="M4 20V4M4 20h17M9 16v-5M14 16V7M19 16v-8"/>', settings: '<path d="m10 3-1 3-3 1-3 3 2 3-1 3 3 3 3-1 3 2 3-2 3 1 2-3-1-3 1-3-3-2-2-2z"/><circle cx="12" cy="12" r="3"/>', backup: '<path d="M5 16a5 5 0 0 1 1-10 7 7 0 0 1 13 2 4 4 0 0 1 0 8M12 11v10M8 17l4 4 4-4"/>', search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>', arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>', download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>', print: '<path d="M7 8V3h10v5M7 17H3V9h18v8h-4M7 14h10v7H7zM17 11h1"/>', edit: '<path d="m16 3 5 5-12 12-6 1 1-6zM14 5l5 5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>', check: '<path d="m5 12 4 4L20 5"/>', reminders: '<path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 21h4M12 2v2"/>', logout: '<path d="M9 4H4v16h5M12 12h9m-4-4 4 4-4 4"/>', upload: '<path d="M12 16V3M7 8l5-5 5 5M4 16v5h16v-5"/>', audit: '<path d="M6 3h12v18H6zM9 7h6M9 11h6M9 15h4"/>', rupee: '<path d="M7 4h11M7 8h11M7 4c8 0 8 8 0 8l9 9"/>' }[name] || '<circle cx="12" cy="12" r="8"/>'}</svg>`;
export const badge = (status) =>
  `<span class="badge ${esc(status.toLowerCase().replaceAll(" ", "-"))}">${esc(status)}</span>`;
export const field = (label, name, value = "", options = {}) =>
  `<label class="field ${options.full ? "span-two" : ""}"><span>${esc(label)}</span>${options.type === "date" ? dateInput(name, value, { label, required: options.required }) : options.textarea ? `<textarea name="${name}" ${options.required ? "required" : ""} maxlength="${options.max || 3000}">${esc(value)}</textarea>` : `<input name="${name}" type="${options.type || "text"}" value="${esc(value)}" ${options.required ? "required" : ""} ${options.step ? 'step="' + options.step + '"' : ""} ${options.min !== undefined ? 'min="' + options.min + '"' : ""} maxlength="${options.max || 500}" ${options.placeholder ? 'placeholder="' + esc(options.placeholder) + '"' : ""} ${options.autocomplete ? 'autocomplete="' + options.autocomplete + '"' : ""}>`}${options.help ? `<p class="help">${esc(options.help)}</p>` : ""}</label>`;
export const pageHeader = (
  title,
  subtitle,
  actions = "",
  eyebrow = "OWNER CONSOLE",
) =>
  `<div class="page-header"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
export const empty = (title, detail = "", action = "") =>
  `<div class="empty">${icon("invoice")}<strong>${esc(title)}</strong>${esc(detail)}${action ? `<div class="actions">${action}</div>` : ""}</div>`;
export function toast(message, error = false) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.textContent = message;
  $("#toasts").append(el);
  setTimeout(() => el.remove(), error ? 9000 : 4500);
}
export async function api(url, { method = "GET", body, form } = {}) {
  const headers = {};
  if (method !== "GET" && state.owner?.csrf)
    headers["X-CSRF-Token"] = state.owner.csrf;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(url, {
    method,
    headers,
    body: form || (body !== undefined ? JSON.stringify(body) : undefined),
    credentials: "same-origin",
  });
  let data;
  try {
    data = await response.json();
  } catch {
    data = { detail: "The server returned an unexpected response" };
  }
  if (!response.ok) {
    if (
      response.status === 401 &&
      url !== "/api/auth/login" &&
      url !== "/api/auth/me"
    ) {
      state.owner = null;
      window.dispatchEvent(new Event("session-expired"));
    }
    let message = data.detail || "Request failed";
    if (Array.isArray(message))
      message = message
        .map((x) => x.loc.slice(1).join(".") + ": " + x.msg)
        .join("; ");
    throw new Error(message);
  }
  return data;
}
export function pager(data, onPage, parent) {
  const pages = Math.max(1, Math.ceil(data.total / data.page_size));
  const el = document.createElement("div");
  el.className = "pager";
  el.innerHTML = `<span>${data.total ? (data.page - 1) * data.page_size + 1 + "–" + Math.min(data.page * data.page_size, data.total) : "0"} of ${data.total.toLocaleString("en-IN")} records</span><div class="actions"><button class="small" data-prev ${data.page <= 1 ? "disabled" : ""}>Previous</button><span>Page ${data.page} of ${pages}</span><button class="small" data-next ${data.page >= pages ? "disabled" : ""}>Next</button></div>`;
  $("[data-prev]", el).onclick = () => onPage(data.page - 1);
  $("[data-next]", el).onclick = () => onPage(data.page + 1);
  parent.append(el);
}
export function modal(
  title,
  body,
  { wide = false, save = "Save", onSave = null, footer = "" } = {},
) {
  const el = $("#modal");
  if (el.open) el.close();
  el.className = wide ? "wide" : "";
  el.innerHTML = `<form><div class="modal-head"><h2>${esc(title)}</h2><button type="button" data-close class="icon-button" aria-label="Close dialog">${icon("close")}</button></div><div class="modal-body"><div class="modal-error" role="alert"></div>${body}</div><div class="modal-foot">${footer}<button type="button" data-close>Close</button>${onSave ? `<button type="submit" class="primary">${esc(save)}</button>` : ""}</div></form>`;
  $$("[data-close]", el).forEach((b) => (b.onclick = () => el.close()));
  bindDates(el);
  $("form", el).onsubmit = async (event) => {
    event.preventDefault();
    const button = $("[type=submit]", el);
    button.disabled = true;
    $(".modal-error", el).textContent = "";
    try {
      await onSave($("form", el));
      el.close();
    } catch (error) {
      $(".modal-error", el).textContent = error.message;
    } finally {
      button.disabled = false;
    }
  };
  el.showModal();
  return el;
}
export function reasonDialog(title, onSave) {
  return modal(
    title,
    field("Reason", "reason", "", {
      required: true,
      textarea: true,
      max: 1000,
    }),
    { save: title, onSave: (form) => onSave(new FormData(form).get("reason")) },
  );
}
export function confirmLeave() {
  return new Promise((resolve) => {
    const el = modal(
      "Leave invoice?",
      `<p class="subtitle">There are unsaved changes. Continue editing, or leave this screen?</p>`,
      { save: "Leave screen", onSave: () => resolve(true) },
    );
    el.addEventListener("close", () => resolve(false), { once: true });
    $("[data-close]", el).textContent = "Continue editing";
  });
}
export function formData(form) {
  const data = Object.fromEntries(new FormData(form));
  $$("input[data-date]", form).forEach((input) => {
    data[input.name] = dateValue(input);
  });
  return data;
}
export function invoiceTable(rows) {
  if (!rows.length)
    return empty(
      "No invoices yet",
      "Your saved invoices and drafts will appear here.",
    );
  return `<div class="table-scroll"><table><thead><tr><th>Invoice no.</th><th>Date</th><th>Customer</th><th class="number">Taxable</th><th class="number">Total</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="/invoices/${r.id}" class="mono">${esc(r.number || "DRAFT")}</a>${r.historical ? '<span class="historical">H</span>' : ""}</td><td class="muted no-wrap">${displayDate(r.invoice_date)}</td><td>${esc(r.customer_name || "—")}</td><td class="number muted">${r.historical ? "—" : money(r.taxable)}</td><td class="number strong">${money(r.total)}</td><td>${badge(r.status)}</td><td><a href="/invoices/${r.id}" aria-label="Open invoice ${esc(r.number || "draft")}">${icon("arrow")}</a></td></tr>`).join("")}</tbody></table></div>`;
}
export function printInvoice(id, existingWindow = null) {
  const url = `/api/invoices/${id}/pdf?download=false`;
  const win = existingWindow || window.open(url, "_blank");
  if (existingWindow) {
    win.location.href = url;
  }
  if (win) {
    win.onload = () => {
      setTimeout(() => {
        try {
          win.print();
        } catch {}
      }, 700);
    };
  } else {
    toast(
      "Your browser blocked the PDF tab. Use Download PDF to open the invoice.",
      true,
    );
  }
}
export function autocomplete(input, { kind, onSelect, onCustom = null }) {
  const wrap = input.closest(".autocomplete");
  const list = document.createElement("div");
  list.className = "suggestions";
  list.id = "suggest-" + crypto.randomUUID();
  list.setAttribute("role", "listbox");
  wrap.append(list);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-controls", list.id);
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  let results = [],
    active = -1,
    sequence = 0;
  const close = () => {
    list.innerHTML = "";
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  };
  const choose = (item) => {
    close();
    onSelect(item);
  };
  const search = debounce(async () => {
    const seq = ++sequence;
    try {
      const data = await api(
        `/api/${kind}?q=${encodeURIComponent(input.value)}&page_size=15`,
      );
      if (seq !== sequence || !document.body.contains(input)) return;
      results = data.rows;
      active = -1;
      list.innerHTML =
        results
          .map(
            (r, i) =>
              `<div class="suggestion" role="option" id="${list.id}-${i}" data-option="${i}">${esc(r.name)}<small>${esc(kind === "customers" ? [r.place, r.city, r.phone].filter(Boolean).join(" · ") : (r.default_rate === null ? "Rate not set" : money(r.default_rate)) + " · " + r.unit)}</small></div>`,
          )
          .join("") ||
        '<div class="search-empty">No matches. ' +
          (onCustom
            ? "Enter a custom description."
            : "Use + to add a customer.") +
          "</div>";
      input.setAttribute("aria-expanded", "true");
      $$("[data-option]", list).forEach(
        (el) =>
          (el.onmousedown = (event) => {
            event.preventDefault();
            choose(results[+el.dataset.option]);
          }),
      );
    } catch (error) {
      toast(error.message, true);
    }
  }, 150);
  input.addEventListener("input", search);
  input.addEventListener("focus", search);
  input.addEventListener("blur", () => setTimeout(close, 150));
  input.addEventListener("keydown", (event) => {
    if (
      ["ArrowDown", "ArrowUp"].includes(event.key) &&
      results.length &&
      list.innerHTML
    ) {
      event.preventDefault();
      active =
        (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
        results.length;
      $$(".suggestion", list).forEach((el, i) => {
        el.classList.toggle("active", i === active);
        el.setAttribute("aria-selected", i === active ? "true" : "false");
      });
      const el = $(`[data-option="${active}"]`, list);
      input.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView({ block: "nearest" });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (active >= 0 && list.innerHTML) choose(results[active]);
      else if (onCustom) {
        close();
        onCustom();
      }
    } else if (event.key === "Escape") {
      close();
      event.stopPropagation();
    }
  });
  return { close };
}
