import {
  state,
  $,
  $$,
  esc,
  money,
  amount,
  today,
  displayDate,
  displayDateTime,
  reportDate,
  dateInput,
  dateValue,
  bindDates,
  debounce,
  icon,
  badge,
  field,
  pageHeader,
  empty,
  toast,
  api,
  pager,
  modal,
  reasonDialog,
  formData,
  invoiceTable,
  printInvoice,
} from "./core.js?v=20261019-sidebar-calendar";

const newButton = (label, action, id) =>
  `<button class="primary" ${id ? 'id="' + id + '"' : ""} ${action ? 'data-action="' + action + '"' : ""}>${icon("plus")}${label}</button>`;
function masterDeleteAction(dialog, kind, record) {
  if (!record?.id) return;
  const label = kind === "customers" ? "customer" : "item";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "danger delete-master";
  button.textContent = "Delete " + label;
  $(".modal-foot", dialog).prepend(button);
  button.onclick = () => {
    const confirmation = modal(
      "Delete " + label + "?",
      `<p>Delete <strong>${esc(record.name)}</strong> from your ${kind}?</p><p class="subtitle">Saved invoices, item descriptions, totals and payments will be kept. This ${label} will no longer appear in your list or be available for new invoices. This cannot be undone.</p>`,
      {
        save: "Delete " + label,
        onSave: async () => {
          await api(`/api/${kind}/${record.id}`, {
            method: "DELETE",
            body: { confirmation: "DELETE" },
          });
          toast((label === "customer" ? "Customer" : "Item") + " deleted");
          await state.navigate("/" + kind);
        },
      },
    );
    $("[type=submit]", confirmation).classList.add("danger");
  };
}
export function customerModal(
  customer = null,
  onSaved = () => state.navigate("/customers"),
) {
  const d = customer || {};
  const body = `<div class="form-grid">${field("Customer name", "name", d.name, { required: true, full: true, max: 200 })}${field("Place / address", "place", d.place, { full: true, textarea: true, max: 1000 })}${field("City", "city", d.city)}${field("State", "state", d.state || "Karnataka")}${field("PIN code", "pincode", d.pincode, { max: 20 })}${field("Phone", "phone", d.phone, { max: 80 })}${field("GSTIN (optional)", "gstin", d.gstin, { max: 30 })}${field("Email (optional)", "email", d.email, { type: "email", max: 254 })}${field("Notes", "notes", d.notes, { full: true, textarea: true })}<label class="check span-two"><input name="active" type="checkbox" ${d.active !== 0 ? "checked" : ""}>Active customer</label></div>`;
  const dialog = modal(customer ? "Edit customer" : "Add customer", body, {
    save: "Save customer",
    onSave: async (form) => {
      const data = formData(form);
      data.active = $("[name=active]", form).checked;
      const result = await api(
        "/api/customers" + (customer ? "/" + d.id : ""),
        { method: customer ? "PUT" : "POST", body: data },
      );
      toast("Customer saved");
      await onSaved(result);
    },
  });
  masterDeleteAction(dialog, "customers", customer);
  return dialog;
}
export function itemModal(
  item = null,
  onSaved = () => state.navigate("/items"),
) {
  const d = item || {};
  const dialog = modal(
    item ? "Edit item" : "Add item",
    `<div class="form-grid">${field("Item name", "name", d.name, { required: true, full: true })}${field("Description", "description", d.description, { textarea: true, full: true, max: 1000 })}${field("Default selling rate (GST included)", "default_rate", d.default_rate == null ? "" : amount(d.default_rate), { type: "number", step: ".01", min: 0, help: "Leave blank when the selling rate is not set." })}${field("GST rate (%)", "gst_rate", d.gst_rate || state.settings.default_gst, { type: "number", step: ".01", min: 0, required: true })}${field("Unit", "unit", d.unit || "Nos", { required: true, max: 30 })}${field("HSN / SAC (optional)", "hsn", d.hsn, { max: 30 })}<label class="check span-two"><input name="active" type="checkbox" ${d.active !== 0 ? "checked" : ""}>Active item</label></div>`,
    {
      save: "Save item",
      onSave: async (form) => {
        const data = formData(form);
        data.active = $("[name=active]", form).checked;
        if (data.default_rate === "") data.default_rate = null;
        const result = await api("/api/items" + (item ? "/" + d.id : ""), {
          method: item ? "PUT" : "POST",
          body: data,
        });
        toast("Item saved");
        await onSaved(result);
      },
    },
  );
  masterDeleteAction(dialog, "items", item);
  return dialog;
}

export async function dashboard(root) {
  const d = await api("/api/dashboard");
  const months = [];
  const date = new Date(d.today + "T12:00:00");
  for (let i = 11; i >= 0; i--) {
    const dt = new Date(date.getFullYear(), date.getMonth() - i, 1);
    const key =
      dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
    months.push({
      label: new Intl.DateTimeFormat("en", { month: "short" }).format(dt),
      total: d.monthly.find((x) => x.month === key)?.total || 0,
    });
  }
  const max = Math.max(1, ...months.map((x) => x.total));
  root.innerHTML =
    pageHeader(
      "Dashboard",
      displayDate(d.today),
      `<a href="/invoices/new" class="button-link"><button class="primary">${icon("plus")}New invoice</button></a>`,
      "BUSINESS OVERVIEW",
    ) +
    `<div class="stats">${[
      ["Sales today", money(d.sales_today), "Invoices dated today", "rupee"],
      [
        "Sales this month",
        money(d.sales_month),
        d.invoices_month + " invoices this month",
        "reports",
      ],
      [
        "Outstanding",
        money(d.outstanding),
        "Balance on finalized invoices",
        "payments",
      ],
      ["Customers", d.customers, d.items + " active items", "customers"],
    ]
      .map(
        ([label, value, foot, i]) =>
          `<div class="stat">${icon(i)}<div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></div>`,
      )
      .join("")}</div>` +
    `<div class="panel"><div class="panel-head"><h2>Recent invoices</h2><a href="/invoices" class="small-type">View all invoices →</a></div>${invoiceTable(d.recent)}</div>` +
    `<div class="grid-two"><div class="panel"><div class="panel-head"><h2>Monthly sales</h2><span class="subtitle">LAST 12 MONTHS</span></div><div class="panel-body"><div class="chart">${months.map((m) => `<div class="chart-column" title="${m.label}: ${money(m.total)}"><div class="chart-bar" style="height:${Math.max(2, (m.total / max) * 100)}px"></div><small>${m.label}</small></div>`).join("")}</div></div></div><div class="panel"><div class="panel-head"><h2>Quick actions</h2><span class="subtitle">${d.drafts} saved drafts</span></div><div class="panel-body quick-actions"><a href="/invoices/new" class="quick-action"><span class="quick-icon">${icon("invoice")}</span><div><strong>Create an invoice</strong><small>GST-inclusive billing</small></div><span>→</span></a><a href="#" id="quick-customer" class="quick-action"><span class="quick-icon">${icon("customers")}</span><div><strong>Add a customer</strong><small>Keep customer details ready</small></div><span>→</span></a><a href="/import" class="quick-action"><span class="quick-icon">${icon("upload")}</span><div><strong>Import from Excel</strong><small>Review and bring in your workbook</small></div><span>→</span></a></div></div></div>`;
  $("#quick-customer", root).onclick = (e) => {
    e.preventDefault();
    customerModal(null, () => dashboard(root));
  };
}

export async function masters(root, kind) {
  const customer = kind === "customers";
  let page = 1,
    query = "",
    sequence = 0,
    showAll = false;
  root.innerHTML =
    pageHeader(
      customer ? "Customers" : "Items",
      customer
        ? "Manage your customers and their billing details."
        : "Product descriptions and GST-inclusive selling rates.",
      `<a href="/api/export/${kind}"><button>${icon("download")}Export Excel</button></a>` +
        newButton(customer ? "Add customer" : "Add item", "", "add-master"),
      "MASTERS",
    ) +
    `<div class="toolbar"><div class="search">${icon("search")}<input id="master-search" aria-label="Search ${kind}" placeholder="${customer ? "Search name, place, phone or GSTIN…" : "Search item name or HSN…"}"></div><label class="check"><input type="checkbox" id="show-inactive">Include inactive</label></div><div class="panel" id="master-list"></div>`;
  $("#add-master", root).onclick = () =>
    customer ? customerModal(null, load) : itemModal(null, load);
  $("#master-search", root).oninput = debounce((e) => {
    query = e.target.value;
    page = 1;
    load();
  });
  $("#show-inactive", root).onchange = (e) => {
    showAll = e.target.checked;
    page = 1;
    load();
  };
  async function load() {
    const seq = ++sequence;
    const data = await api(
      `/api/${kind}?q=${encodeURIComponent(query)}&page=${page}&all_records=${showAll}`,
    );
    if (seq !== sequence || !root.isConnected) return;
    const list = $("#master-list", root);
    list.innerHTML = data.rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>${customer ? "Customer" : "Item description"}</th>${customer ? "<th>Place / city</th><th>Phone</th><th>GSTIN</th>" : '<th class="number">Default rate</th><th>GST</th><th>Unit</th>'}<th></th></tr></thead><tbody>${data.rows.map((r) => `<tr><td><a href="/${kind}/${r.id}" class="strong">${esc(r.name)}</a>${!r.active ? ' <span class="badge">Inactive</span>' : ""}</td>${customer ? `<td class="muted">${esc([r.place, r.city].filter(Boolean).join(", "))}</td><td class="muted">${esc(r.phone || "—")}</td><td class="mono muted">${esc(r.gstin || "—")}</td>` : `<td class="number">${r.default_rate === null ? '<span class="muted">Not set</span>' : money(r.default_rate)}</td><td class="muted">${esc(r.gst_rate)}%</td><td class="muted">${esc(r.unit)}</td>`}<td><div class="row-actions"><button class="small" data-edit="${r.id}">${icon("edit")}Edit</button></div></td></tr>`).join("")}</tbody></table></div>`
      : empty(
          customer ? "No customers found" : "No items found",
          query
            ? "Try another search."
            : "Add a record or import your existing workbook.",
        );
    pager(
      data,
      (p) => {
        page = p;
        load();
      },
      list,
    );
    $$("[data-edit]", list).forEach(
      (button) =>
        (button.onclick = () => {
          const record = data.rows.find((x) => x.id === button.dataset.edit);
          customer ? customerModal(record, load) : itemModal(record, load);
        }),
    );
  }
  await load();
}

export async function profile(root, kind, id) {
  const d = await api(`/api/${kind}/${id}`);
  const customer = kind === "customers";
  root.innerHTML =
    pageHeader(
      d.name,
      customer
        ? [d.place, d.city, d.state].filter(Boolean).join(", ")
        : "Item history and recent selling rates.",
      `<button id="profile-edit">${icon("edit")}Edit ${customer ? "customer" : "item"}</button>` +
        (customer
          ? `<a href="/invoices/new?customer=${id}"><button class="primary">${icon("plus")}New invoice</button></a>`
          : ""),
      "MASTERS",
    ) +
    (customer
      ? `<div class="stats">${[
          ["Total purchases", money(d.summary.purchases)],
          ["Invoices", d.summary.invoices],
          ["Outstanding", money(d.summary.outstanding)],
          ["Last purchase", displayDate(d.summary.last_purchase)],
        ]
          .map(
            ([label, value]) =>
              `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:22px">${value}</div></div>`,
          )
          .join(
            "",
          )}</div><div class="panel"><div class="summary-grid"><div><label>Contact</label><p>${esc(d.phone || "No phone supplied")}<br>${esc(d.email)}</p></div><div><label>GSTIN</label><p class="mono">${esc(d.gstin || "Not supplied")}</p></div><div><label>Notes</label><p>${esc(d.notes || "—")}</p></div></div></div><div class="panel"><div class="panel-head"><h2>Invoice history</h2><span class="subtitle">Latest 50</span></div>${invoiceTable(d.invoices)}</div>`
      : `<div class="panel"><div class="summary-grid"><div><label>Default selling rate</label><p>${d.default_rate === null ? "Not set" : money(d.default_rate)}</p></div><div><label>GST / unit</label><p>${esc(d.gst_rate)}% / ${esc(d.unit)}</p></div><div><label>HSN</label><p>${esc(d.hsn || "Not set")}</p></div></div></div><div class="panel"><div class="panel-head"><h2>Recent sales</h2><span class="subtitle">Latest 100 invoice lines</span></div>${d.history.length ? `<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="number">Quantity</th><th class="number">Selling rate</th></tr></thead><tbody>${d.history.map((h) => `<tr><td><a href="/invoices/${h.id}">${esc(h.number)}</a></td><td>${displayDate(h.invoice_date)}</td><td>${esc(h.customer)}</td><td class="number">${esc(h.quantity)}</td><td class="number">${money(h.unit_price)}</td></tr>`).join("")}</tbody></table></div>` : empty("No sales for this item yet")}</div>`);
  $("#profile-edit", root).onclick = () =>
    customer
      ? customerModal(d, () => profile(root, kind, id))
      : itemModal(d, () => profile(root, kind, id));
}

export async function history(root) {
  let page = 1,
    seq = 0;
  root.innerHTML =
    pageHeader(
      "Invoice history",
      "Find saved invoices, drafts, payments and PDF copies.",
      `<a href="/invoices/new"><button class="primary">${icon("plus")}New invoice</button></a>`,
      "SALES",
    ) +
    `<div class="toolbar"><div class="search">${icon("search")}<input id="invoice-search" aria-label="Search invoices" placeholder="Invoice no., customer, phone, GSTIN or amount…"></div><select id="invoice-status" aria-label="Invoice status"><option value="">All statuses</option>${["Draft", "Unpaid", "Partially Paid", "Paid", "Cancelled"].map((s) => `<option>${s}</option>`)}</select><select id="date-preset" aria-label="Date range"><option value="">All dates</option><option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="custom">Custom range</option></select>${dateInput("start", "", { id: "invoice-start", label: "From date" })}${dateInput("end", "", { id: "invoice-end", label: "To date" })}</div><div class="panel" id="invoice-list"></div>`;
  bindDates(
    root,
    debounce(() => {
      page = 1;
      load().catch((e) => toast(e.message, true));
    }),
  );
  async function load() {
    const current = ++seq;
    const params = new URLSearchParams({
      q: $("#invoice-search", root).value,
      status: $("#invoice-status", root).value,
      start: dateValue($("#invoice-start", root)),
      end: dateValue($("#invoice-end", root)),
      page,
    });
    const data = await api("/api/invoices?" + params);
    if (current !== seq || !root.isConnected) return;
    const panel = $("#invoice-list", root);
    panel.innerHTML = invoiceTable(data.rows);
    pager(
      data,
      (p) => {
        page = p;
        load();
      },
      panel,
    );
  }
  $("#invoice-search", root).oninput = debounce(() => {
    page = 1;
    load().catch((e) => toast(e.message, true));
  });
  $$("select,input[data-date]", root).forEach(
    (e) =>
      (e.onchange = () => {
        if (e.id === "date-preset") {
          const now = today();
          let start = "";
          if (e.value === "today") start = now;
          if (e.value === "month") start = now.slice(0, 7) + "-01";
          if (e.value === "week") {
            const d = new Date(now + "T12:00:00");
            d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
            start =
              d.getFullYear() +
              "-" +
              String(d.getMonth() + 1).padStart(2, "0") +
              "-" +
              String(d.getDate()).padStart(2, "0");
          }
          if (e.value !== "custom") {
            $("#invoice-start", root).value = start ? displayDate(start) : "";
            $("#invoice-end", root).value = start ? displayDate(now) : "";
          }
        }
        page = 1;
        load().catch((e) => toast(e.message, true));
      }),
  );
  await load();
}

export function paymentModal(invoice, onSaved, payment = null) {
  const p = payment || {};
  const body = `<div class="inline-note info">Invoice ${esc(invoice.number)} · ${esc(invoice.customer_snapshot.name)}<br>Balance due: <strong>${money(invoice.balance)}</strong></div><div class="form-grid">${field("Payment date", "payment_date", p.payment_date || today(), { type: "date", required: true })}${field("Amount (₹)", "amount", p.amount ? amount(p.amount) : amount(invoice.balance), { type: "number", step: ".01", min: ".01", required: true })}<label class="field"><span>Payment method</span><select name="method">${["Cash", "UPI", "Bank Transfer", "Cheque", "Other"].map((x) => `<option ${x === p.method ? "selected" : ""}>${x}</option>`).join("")}</select></label>${field("Reference number", "reference", p.reference, { max: 200 })}${field("Notes", "notes", p.notes, { textarea: true, full: true, max: 2000 })}</div>`;
  const key = crypto.randomUUID();
  return modal(payment ? "Edit payment" : "Record payment", body, {
    save: payment ? "Save changes" : "Record payment",
    onSave: async (form) => {
      await api("/api/payments" + (payment ? "/" + p.id : ""), {
        method: payment ? "PUT" : "POST",
        body: {
          ...formData(form),
          invoice_id: invoice.id,
          idempotency_key: key,
        },
      });
      toast("Payment saved");
      await onSaved();
    },
  });
}

export async function invoiceDetail(root, id) {
  const d = await api("/api/invoices/" + id);
  const c = d.customer_snapshot;
  const taxLabel = d.business_snapshot.legacy_labels
    ? "Discount"
    : "Taxable value";
  const available = d.status !== "Cancelled";
  root.innerHTML =
    pageHeader(
      d.number ? "Invoice " + d.number : "Draft invoice",
      displayDate(d.invoice_date) + " · " + c.name,
      `<a href="/api/invoices/${id}/pdf"><button>${icon("download")}Download PDF</button></a><button id="print-invoice">${icon("print")}Print</button>`,
      "SALES",
    ) +
    (d.historical
      ? '<div class="inline-note">Historical total-only record. The workbook did not supply item details, tax breakdown or payment history. Verify the outstanding balance against your records.</div>'
      : "") +
    `<div class="panel"><div class="detail-header"><div><div class="eyebrow">${esc(d.business_snapshot.business_name)}</div><h2>TAX INVOICE</h2><span class="mono">${esc(d.number || "Number assigned when finalized")}</span></div><div>${badge(d.status)}<p class="help">${d.due_date ? "Due " + displayDate(d.due_date) : ""}</p></div></div><div class="summary-grid"><div><label>Bill to</label><p><strong>${esc(c.name)}</strong><br>${esc([c.place, [c.city, c.state, c.pincode].filter(Boolean).join(", ")].filter(Boolean).join("\n"))}</p></div><div><label>Contact</label><p>${esc(c.phone || "—")}<br>${esc(c.gstin || "No GSTIN supplied")}</p></div><div><label>Payment summary</label><p>Invoice total: ${money(d.total)}<br>Amount paid: ${money(d.paid)}<br><strong>Balance due: ${money(d.balance)}</strong></p></div></div>${d.lines.length ? `<div class="table-scroll"><table><thead><tr><th>Sl.</th><th>Description of goods</th><th class="number">Quantity</th><th class="number">Rate</th><th class="number">Amount</th><th class="number">${taxLabel}</th></tr></thead><tbody>${d.lines.map((l, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(l.description)}${l.discount ? `<p class="help">Discount ${esc(l.discount_percent)}%: ${money(l.discount)}</p>` : ""}</td><td class="number">${esc(l.quantity)}</td><td class="number">${money(l.unit_price)}</td><td class="number">${money(l.amount)}</td><td class="number muted">${money(l.taxable)}</td></tr>`).join("")}</tbody></table></div>` : ""}<div class="invoice-bottom"><div class="detail-notes">${esc(d.amount_words)}<br><br><strong>Terms</strong><br>${esc(d.terms || d.business_snapshot.terms)}${d.notes ? "<br><br><strong>Notes</strong><br>" + esc(d.notes) : ""}</div><div class="totals">${!d.historical ? `<div><span>Taxable total</span><strong>${money(d.taxable)}</strong></div>${d.tax_groups.map((g) => `<div><span>CGST ${+g.gst_rate / 2}%</span><strong>${money(g.cgst)}</strong></div><div><span>SGST ${+g.gst_rate / 2}%</span><strong>${money(g.sgst)}</strong></div>`).join("")}${d.rounding ? `<div><span>Rounding adjustment</span><strong>${money(d.rounding)}</strong></div>` : ""}` : ""}<div class="grand"><span>Grand total</span><span>${money(d.total)}</span></div></div></div><div class="invoice-footer"><span class="save-state">Saved ${esc(displayDateTime(d.updated_at))} UTC</span><div class="actions">${available && !d.historical ? `<a href="/invoices/${id}/edit"><button>${icon("edit")}${d.status === "Draft" ? "Continue draft" : "Edit invoice"}</button></a><a href="/invoices/new?duplicate=${id}"><button>${icon("copy")}Duplicate</button></a>` : ""}${!["Draft", "Cancelled", "Paid"].includes(d.status) ? '<button class="primary" id="record-payment">' + icon("payments") + "Record payment</button>" : ""}${available ? '<button class="danger" id="cancel-invoice">Cancel invoice</button>' : ""}</div></div></div><div class="panel"><div class="panel-head"><h2>Payments</h2><span class="subtitle">${money(d.paid)} received</span></div>${d.payments.length ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="number">Amount</th><th></th></tr></thead><tbody>${d.payments.map((p) => `<tr><td>${displayDate(p.payment_date)}</td><td>${esc(p.method)} ${p.voided ? badge("Voided") : ""}</td><td class="muted">${esc(p.reference || "—")}</td><td class="number">${money(p.amount)}</td><td><div class="row-actions">${!p.voided ? `<button class="small" data-edit-payment="${p.id}">Edit</button><button class="small danger" data-void-payment="${p.id}">Void</button>` : ""}</div></td></tr>`).join("")}</tbody></table></div>` : empty("No payments recorded")}</div>`;
  $("#print-invoice", root).onclick = () => printInvoice(id);
  $("#record-payment", root)?.addEventListener("click", () =>
    paymentModal(d, () => invoiceDetail(root, id)),
  );
  $("#cancel-invoice", root)?.addEventListener("click", () =>
    reasonDialog("Cancel invoice", async (reason) => {
      await api(`/api/invoices/${id}/cancel`, {
        method: "POST",
        body: { reason },
      });
      toast("Invoice cancelled");
      await invoiceDetail(root, id);
    }),
  );
  $$("[data-edit-payment]", root).forEach(
    (el) =>
      (el.onclick = () =>
        paymentModal(
          d,
          () => invoiceDetail(root, id),
          d.payments.find((p) => p.id === el.dataset.editPayment),
        )),
  );
  $$("[data-void-payment]", root).forEach(
    (el) =>
      (el.onclick = () =>
        reasonDialog("Void payment", async (reason) => {
          await api(`/api/payments/${el.dataset.voidPayment}/void`, {
            method: "POST",
            body: { reason },
          });
          toast("Payment voided");
          await invoiceDetail(root, id);
        })),
  );
}

export async function payments(root) {
  let page = 1;
  root.innerHTML =
    pageHeader(
      "Payments",
      "Track receipts against finalized invoices.",
      "",
      "COLLECTIONS",
    ) +
    `<div class="toolbar"><label class="field"><span>From</span>${dateInput("start", "", { id: "payments-start", label: "From date" })}</label><label class="field"><span>To</span>${dateInput("end", "", { id: "payments-end", label: "To date" })}</label><div class="actions"><button id="choose-payment" class="primary">${icon("plus")}Record payment</button></div></div><div class="panel" id="payments-list"></div>`;
  bindDates(
    root,
    debounce(() => {
      page = 1;
      load().catch((e) => toast(e.message, true));
    }),
  );
  async function load() {
    const d = await api(
      `/api/payments?page=${page}&start=${dateValue($("#payments-start", root))}&end=${dateValue($("#payments-end", root))}`,
    );
    const panel = $("#payments-list", root);
    panel.innerHTML = d.rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>Date</th><th>Invoice</th><th>Customer</th><th>Method / reference</th><th class="number">Received</th><th>Status</th></tr></thead><tbody>${d.rows.map((p) => `<tr><td>${displayDate(p.payment_date)}</td><td><a href="/invoices/${p.invoice_id}" class="mono">${esc(p.number)}</a></td><td>${esc(p.customer)}</td><td>${esc(p.method)}<p class="help">${esc(p.reference)}</p></td><td class="number strong">${money(p.amount)}</td><td>${p.voided ? badge("Voided") : badge("Paid")}</td></tr>`).join("")}</tbody></table></div>`
      : empty(
          "No payments found",
          "Open an unpaid invoice to record a receipt.",
        );
    pager(
      d,
      (p) => {
        page = p;
        load();
      },
      panel,
    );
  }
  $$("input[data-date]", root).forEach(
    (el) =>
      (el.onchange = () => {
        page = 1;
        load().catch((e) => toast(e.message, true));
      }),
  );
  $("#choose-payment", root).onclick = async () => {
    const d = await api("/api/invoices?status=Unpaid&page_size=200");
    const partial = await api(
      "/api/invoices?status=Partially%20Paid&page_size=200",
    );
    const rows = [...d.rows, ...partial.rows];
    modal(
      "Choose an invoice",
      rows.length
        ? `<div class="search">${icon("search")}<input id="payment-invoice-search" placeholder="Filter these invoices…" aria-label="Filter unpaid invoices"></div><div id="payment-invoice-options">${rows.map((i) => `<button type="button" class="quick-action" style="width:100%;margin-top:8px" data-payment-invoice="${i.id}"><span class="mono">${esc(i.number)}</span><span>${esc(i.customer_name)}</span><strong>${money(i.balance)}</strong></button>`).join("")}</div><p class="help">Showing up to 400 unpaid or partly paid invoices. You can also find an invoice in Invoice History.</p>`
        : empty("No outstanding invoices"),
      {},
    );
    $("#payment-invoice-search")?.addEventListener("input", (e) =>
      $$("[data-payment-invoice]").forEach(
        (b) =>
          (b.hidden = !b.textContent
            .toLowerCase()
            .includes(e.target.value.toLowerCase())),
      ),
    );
    $$("[data-payment-invoice]").forEach(
      (el) =>
        (el.onclick = async () => {
          try {
            const invoice = await api(
              "/api/invoices/" + el.dataset.paymentInvoice,
            );
            paymentModal(invoice, load);
          } catch (error) {
            toast(error.message, true);
          }
        }),
    );
  };
  await load();
}

export async function reports(root) {
  let seq = 0;
  root.innerHTML =
    pageHeader(
      "Reports",
      "Sales, GST totals and outstanding invoices for a selected period.",
      "",
      "BUSINESS REPORTS",
    ) +
    `<div class="toolbar"><select id="report-kind" aria-label="Report type">${[
      ["sales", "Sales register"],
      ["daily", "Daily sales"],
      ["monthly", "Monthly sales"],
      ["customers", "Customer-wise sales"],
      ["gst", "GST summary"],
      ["outstanding", "Outstanding payments"],
    ]
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join(
        "",
      )}</select>${dateInput("start", today().slice(0, 7) + "-01", { id: "report-start", label: "Report start", required: true })}<span class="muted small-type">to</span>${dateInput("end", today(), { id: "report-end", label: "Report end", required: true })}<div class="actions"><a id="report-excel"><button>${icon("download")}Excel</button></a><a id="report-pdf" target="_blank" rel="noopener"><button>${icon("print")}PDF / Print</button></a></div></div><div id="report-summary"></div><div class="panel" id="report-data"></div><p class="footer-note">Drafts and cancelled invoices are excluded. Historical total-only records contribute sales totals; their unavailable tax breakdowns are excluded from tax amounts.</p>`;
  bindDates(
    root,
    debounce(() => {
      load().catch((e) => toast(e.message, true));
    }),
  );
  async function load() {
    const current = ++seq;
    const kind = $("#report-kind", root).value;
    const params = new URLSearchParams({
      start: dateValue($("#report-start", root)),
      end: dateValue($("#report-end", root)),
    });
    const url = "/api/reports/" + kind + "?" + params;
    const d = await api(url);
    if (current !== seq) return;
    $("#report-excel", root).href = url + "&format=xlsx";
    $("#report-pdf", root).href = url + "&format=pdf";
    $("#report-summary", root).innerHTML = `<div class="stats">${[
      ["Invoices", d.summary.invoices],
      ["Taxable sales", money(d.summary.taxable)],
      ["CGST + SGST", money(d.summary.cgst + d.summary.sgst)],
      ["Total sales", money(d.summary.total)],
    ]
      .map(
        ([label, value]) =>
          `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value" style="font-size:23px">${value}</div></div>`,
      )
      .join("")}</div>`;
    const keys = d.rows.length
      ? Object.keys(d.rows[0]).filter((k) => k !== "id")
      : [];
    const monetary = [
      "taxable",
      "cgst",
      "sgst",
      "rounding",
      "total",
      "paid",
      "balance",
    ];
    $("#report-data", root).innerHTML = d.rows.length
      ? `<div class="table-scroll"><table><thead><tr>${keys.map((k) => `<th class="${monetary.includes(k) ? "number" : ""}">${esc(k === "label" ? { daily: "Date", monthly: "Month", customers: "Customer", gst: "Month" }[kind] || "Group" : k.replaceAll("_", " "))}</th>`).join("")}</tr></thead><tbody>${d.rows.map((r) => `<tr>${keys.map((k) => `<td class="${monetary.includes(k) ? "number" : ""}">${k === "number" ? `<a href="/invoices/${r.id}">${esc(r[k])}</a>` : k === "status" ? badge(r[k]) : monetary.includes(k) ? (r.historical && ["taxable", "cgst", "sgst", "rounding"].includes(k) ? "—" : money(r[k])) : esc(reportDate(kind, k, r[k]))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
      : empty("No records for this period");
  }
  $$("select,input", root).forEach(
    (el) => (el.onchange = () => load().catch((e) => toast(e.message, true))),
  );
  await load();
}

export async function importPage(root) {
  root.innerHTML =
    pageHeader(
      "Excel import",
      "Bring in customers, products and valid historical orders.",
      "",
      "DATA IMPORT",
    ) +
    `<div class="inline-note info">Nothing is imported until you review the rows and confirm your selection. Customer names are never merged automatically. Numbers inside product descriptions are not treated as selling rates.</div><div class="panel"><div class="panel-body"><div class="form-grid"><label class="field"><span>Data to import</span><select id="import-kind"><option value="customers">Customers · Customer sheet</option><option value="items">Items · Item sheet</option><option value="orders">Historical invoices · Orders sheet</option></select></label><div class="field"><span>Need a template?</span><a id="import-template" href="/api/import/template/customers"><button>${icon("download")}Download blank Excel template</button></a></div></div><div class="import-upload">${icon("upload")}<p class="subtitle">Select your original .xlsx workbook or a UTF-8 .csv file.</p><input type="file" id="import-file" accept=".xlsx,.csv" aria-label="Workbook to import"><p class="help">Maximum 50 MB. Formula-only tails are skipped; rows after long blank gaps need a separate file.</p></div><div class="actions"><button class="primary" id="preview-import">Review import</button><span id="import-progress" class="help"></span></div></div></div><div id="import-review"></div>`;
  $("#import-kind", root).onchange = (e) => {
    $("#import-template", root).href = "/api/import/template/" + e.target.value;
    $("#import-review", root).innerHTML = "";
  };
  $("#preview-import", root).onclick = async () => {
    const file = $("#import-file", root).files[0];
    if (!file) {
      toast("Choose a workbook first", true);
      return;
    }
    const button = $("#preview-import", root);
    button.disabled = true;
    $("#import-progress", root).textContent =
      "Reading workbook and checking rows…";
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", $("#import-kind", root).value);
      const d = await api("/api/import/preview", { method: "POST", form });
      render(d);
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
      $("#import-progress", root).textContent = "";
    }
  };
  function render(d) {
    const review = $("#import-review", root);
    review.innerHTML = `<div class="import-stats"><span><strong>${d.valid}</strong> valid rows</span><span><strong>${d.incomplete}</strong> incomplete / suspicious</span><span><strong>${d.skipped}</strong> blank rows skipped</span><span>Sheet: <strong>${esc(d.sheet)}</strong></span></div><div class="inline-note ${d.truncated ? "" : "info"}">${esc(d.notice)}${d.kind === "orders" ? "<br>Historical totals do not include a reliable tax breakdown or payment history. Select these rows explicitly only after review." : ""}</div><div class="panel"><div class="panel-head"><h2>Review rows</h2><div class="actions"><button class="small" id="select-recommended">Select recommended</button><button class="small" id="select-none">Clear selection</button></div></div><div class="import-table"><table><thead><tr><th>Import</th><th>Excel row</th><th>Record</th><th>Review notes</th></tr></thead><tbody>${d.records.map((r) => `<tr><td><input type="checkbox" aria-label="Import row ${r.row}" data-import-index="${r.index}" ${r.error ? "disabled" : ""} ${r.recommended ? "checked" : ""}></td><td class="mono">${r.row}</td><td>${esc(r.data.name || r.source.name || "Missing name")}${r.data.number ? `<p class="help">Invoice ${esc(r.data.number)} · ${esc(displayDate(r.data.invoice_date))} · ${money(r.data.total)}</p>` : ""}${r.data.place ? '<p class="help">' + esc(r.data.place) + "</p>" : ""}</td><td>${r.error ? `<div class="review-error">${esc(r.error)}</div>` : r.warnings.length ? r.warnings.map((w) => `<div class="review-warning">${esc(w)}</div>`).join("") : '<span class="muted">Ready</span>'}</td></tr>`).join("")}</tbody></table></div><div class="invoice-footer"><span class="save-state" id="selected-count"></span><button class="primary" id="commit-import">Import selected rows</button></div></div>`;
    const count = () =>
      ($("#selected-count", review).textContent =
        $$("[data-import-index]:checked", review).length + " rows selected");
    $$("[data-import-index]", review).forEach((e) => (e.onchange = count));
    $("#select-none", review).onclick = () => {
      $$("[data-import-index]", review).forEach((e) => (e.checked = false));
      count();
    };
    $("#select-recommended", review).onclick = () => {
      $$("[data-import-index]", review).forEach(
        (e) => (e.checked = d.records[+e.dataset.importIndex].recommended),
      );
      count();
    };
    $("#commit-import", review).onclick = async () => {
      const selected = $$("[data-import-index]:checked", review).map(
        (e) => +e.dataset.importIndex,
      );
      if (!selected.length) {
        toast("Select at least one valid row", true);
        return;
      }
      const b = $("#commit-import", review);
      b.disabled = true;
      try {
        const result = await api("/api/import/commit", {
          method: "POST",
          body: { preview_id: d.id, selected },
        });
        toast(`${result.imported} records imported`);
        review.innerHTML = `<div class="inline-note info">Imported ${result.imported} ${esc(result.kind)} records. <a href="/${result.kind === "orders" ? "invoices" : result.kind}">View records →</a></div>`;
      } catch (error) {
        toast(error.message, true);
        b.disabled = false;
      }
    };
    count();
  }
}

export async function settingsPage(root) {
  const d = await api("/api/settings");
  const checks = (items) =>
    `<div class="toggle-group">${items.map(([key, label]) => `<label class="check"><input type="checkbox" name="${key}" ${d[key] ? "checked" : ""}>${label}</label>`).join("")}</div>`;
  root.innerHTML =
    pageHeader(
      "Settings",
      "Business details, invoice numbering and print preferences.",
      "",
      "BUSINESS CONFIGURATION",
    ) +
    `<form id="settings-form"><div class="tabs">${["Business", "Invoices", "Tax & print"].map((x, i) => `<button type="button" data-tab="${i}" class="${i === 0 ? "active" : ""}">${x}</button>`).join("")}</div><div class="settings-section"><section data-section="0"><div class="panel"><div class="panel-body"><h2 class="settings-title">Business information</h2><div class="form-grid">${field("Business name", "business_name", d.business_name, { required: true, full: true })}${field("Address", "address", d.address, { textarea: true, full: true })}${field("City", "city", d.city)}${field("State", "state", d.state)}${field("State code", "state_code", d.state_code)}${field("PIN code", "pincode", d.pincode)}${field("GSTIN", "gstin", d.gstin)}${field("PAN", "pan", d.pan)}${field("Phone", "phone", d.phone)}${field("Email", "email", d.email, { type: "email" })}${field("Bank details", "bank_details", d.bank_details, { textarea: true, full: true })}${field("UPI ID", "upi", d.upi, { full: true })}<label class="field span-two"><span>Business logo (optional)</span><input type="file" accept="image/png,image/jpeg" id="business-logo"><p class="help">PNG or JPEG, up to 200 KB. Used in invoice PDFs.</p><input name="logo" type="hidden" value="${esc(d.logo)}"><button type="button" class="small" id="remove-logo">Remove logo</button></label></div></div></div></section><section data-section="1" hidden><div class="panel"><div class="panel-body"><h2 class="settings-title">Invoice numbering</h2><div class="form-grid">${field("Prefix", "invoice_prefix", d.invoice_prefix, { help: "Example: SVS/ · Leave blank for 1, 2, 3…" })}${field("Next starting number", "next_invoice_number", d.next_invoice_number, { type: "number", min: 1, required: true })}${field("Number padding", "number_padding", d.number_padding, { type: "number", min: 0, help: "0 = 1 · 3 = 001" })}<div class="toggle-group"><label class="check"><input type="checkbox" name="include_financial_year" ${d.include_financial_year ? "checked" : ""}>Include financial year (April–March)</label><label class="check"><input type="checkbox" name="reset_financial_year" ${d.reset_financial_year ? "checked" : ""}>Restart numbering each financial year</label></div></div><p class="help">Yearly resets always include the financial year to keep invoice numbers unique. Existing invoices retain their original number.</p><hr class="divider"><div class="form-grid">${field("Default terms", "terms", d.terms, { textarea: true, full: true })}${field("Declaration", "declaration", d.declaration, { textarea: true, full: true })}${field("Invoice footer", "footer", d.footer, { textarea: true, full: true })}${field("Receiver signature label", "receiver_label", d.receiver_label)}${field("Authorised signatory label", "signatory", d.signatory)}</div></div></div></section><section data-section="2" hidden><div class="panel"><div class="panel-body"><h2 class="settings-title">GST-inclusive pricing</h2><div class="form-grid">${field("Default GST rate (%)", "default_gst", d.default_gst, { type: "number", min: 0, step: ".01", required: true })}<div class="inline-note info">Prices include GST. Tax is split equally into CGST and SGST. Version 1 follows your existing intrastate workflow.</div></div><hr class="divider"><h2 class="settings-title">Printed invoice</h2>${checks(
      [
        ["show_hsn", "Show HSN/SAC"],
        ["show_phone", "Show phone numbers"],
        ["show_gstin", "Show GSTIN"],
        ["show_taxable", "Show taxable value column"],
        ["legacy_labels", "Use legacy “Discount” label for Taxable Value"],
        ["show_receiver", "Show receiver signature"],
        ["show_signatory", "Show authorised signatory"],
        ["enable_discounts", "Enable real line-item discounts"],
      ],
    )}<p class="help">The legacy “Discount” heading represents taxable value. Real discounts are separate and disabled by default.</p></div></div></section><div class="actions"><button type="submit" class="primary">${icon("check")}Save settings</button><span class="help">Finalized invoices keep their original business and print settings.</span></div></div></form>`;
  $$("[data-tab]", root).forEach(
    (b) =>
      (b.onclick = () => {
        $$("[data-tab]", root).forEach((x) =>
          x.classList.toggle("active", x === b),
        );
        $$("[data-section]", root).forEach(
          (s) => (s.hidden = s.dataset.section !== b.dataset.tab),
        );
      }),
  );
  $("#remove-logo", root).onclick = () => {
    $("[name=logo]", root).value = "";
    $("#business-logo", root).value = "";
    toast("Logo will be removed when settings are saved");
  };
  $("#business-logo", root).onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (
      file.size > 200000 ||
      !["image/png", "image/jpeg"].includes(file.type)
    ) {
      toast("Choose a PNG/JPEG up to 200 KB", true);
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      $("[name=logo]", root).value = reader.result;
    };
    reader.readAsDataURL(file);
  };
  $("#settings-form", root).onsubmit = async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = $("[type=submit]", form);
    button.disabled = true;
    try {
      const data = formData(form);
      $$("input[type=checkbox]", form).forEach(
        (c) => (data[c.name] = c.checked),
      );
      data.next_invoice_number = +data.next_invoice_number;
      data.number_padding = +data.number_padding;
      state.settings = await api("/api/settings", {
        method: "PUT",
        body: data,
      });
      toast("Business settings saved");
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
}

export async function backupPage(root) {
  root.innerHTML =
    pageHeader(
      "Backup & export",
      "Keep a portable copy of your business records.",
      "",
      "YOUR DATA",
    ) +
    `<div class="backup-grid">${[
      ["customers", "Customers", "Names, addresses, contacts and GSTINs."],
      ["items", "Items", "Product descriptions, rates and tax settings."],
      [
        "invoices",
        "Invoice register",
        "Invoice totals, tax amounts and payment statuses.",
      ],
    ]
      .map(
        ([key, title, detail]) =>
          `<div class="backup-card">${icon(key === "invoices" ? "invoice" : key)}<h3>${title}</h3><p>${detail}</p><a href="/api/export/${key}"><button>${icon("download")}Export Excel</button></a></div>`,
      )
      .join(
        "",
      )}</div><div class="panel" style="margin-top:22px"><div class="panel-head"><h2>Full business backup</h2>${icon("backup")}</div><div class="panel-body"><p class="subtitle">Download a JSON backup containing business settings, customer and item masters, invoices, invoice lines, payments, numbering sequences and audit records.</p><div class="actions" style="margin:20px 0"><a href="/api/backup"><button class="primary">${icon("download")}Download full backup</button></a><a href="/audit"><button>${icon("audit")}View audit log</button></a></div><p class="help">Store backups privately: they contain customer and financial records. Login credentials and sessions are excluded.</p><hr class="divider"><h2 class="settings-title">Restoring a backup</h2><p class="subtitle">An administrator can restore the downloaded JSON using the server management command described in the repository’s deployment guide. Restore runs offline and keeps a recovery copy of the previous database.</p></div></div>`;
}

export async function auditPage(root) {
  let page = 1;
  root.innerHTML =
    pageHeader(
      "Audit log",
      "Changes to invoices, payments, masters and business settings.",
      "",
      "ACTIVITY",
    ) + '<div class="panel" id="audit-list"></div>';
  async function load() {
    const d = await api("/api/audit?page=" + page);
    const panel = $("#audit-list", root);
    panel.innerHTML = d.rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>Time (UTC)</th><th>Actor</th><th>Action</th><th>Details</th></tr></thead><tbody>${d.rows.map((r) => `<tr><td class="mono no-wrap">${esc(displayDateTime(r.created_at))}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td class="small-type muted">${esc(r.details)}</td></tr>`).join("")}</tbody></table></div>`
      : empty("No activity yet");
    pager(
      d,
      (p) => {
        page = p;
        load();
      },
      panel,
    );
  }
  await load();
}

export function backupInitialization(root) {
  const panel = document.createElement("div");
  panel.className = "panel";
  panel.innerHTML = `<div class="panel-head"><h2>Load initial business data</h2>${icon("upload")}</div><div class="panel-body"><p class="subtitle">Load a prepared SVS JSON backup into a newly deployed, empty workspace. Existing business data is never overwritten through this screen.</p><div class="toolbar" style="margin-top:18px"><input type="file" id="initial-data-file" accept=".json" aria-label="Initial business data backup"><button id="review-initial-data">Review initial data</button></div><p class="help">Only the signed-in owner can use this import. Your owner login is kept.</p></div>`;
  root.append(panel);
  $("#review-initial-data", panel).onclick = async () => {
    const file = $("#initial-data-file", panel).files[0];
    if (!file) {
      toast("Choose the private initial-data JSON file first", true);
      return;
    }
    const button = $("#review-initial-data", panel);
    button.disabled = true;
    try {
      const form = new FormData();
      form.append("file", file);
      const d = await api("/api/backup/preview", { method: "POST", form });
      modal(
        "Load initial business data",
        `<div class="inline-note info">This backup contains <strong>${d.counts.customers}</strong> customers, <strong>${d.counts.items}</strong> items, <strong>${d.counts.invoices}</strong> invoices and <strong>${d.counts.payments}</strong> payments.</div><p class="subtitle">Your owner login will be preserved. The workspace must have no customers, items, invoices or payments.</p><div style="margin-top:20px">${field("Type IMPORT to confirm", "confirmation", "", { required: true })}</div>`,
        {
          save: "Load business data",
          onSave: async (form) => {
            await api("/api/backup/initialize", {
              method: "POST",
              body: {
                preview_id: d.id,
                confirmation: formData(form).confirmation,
              },
            });
            state.settings = await api("/api/settings");
            toast("Initial business data loaded");
            state.navigate("/");
          },
        },
      );
    } catch (error) {
      toast(error.message, true);
    } finally {
      button.disabled = false;
    }
  };
}

export async function reminders(root) {
  const d = await api("/api/invoices?status=Unpaid&page_size=200");
  const partial = await api(
    "/api/invoices?status=Partially%20Paid&page_size=200",
  );
  const rows = [...d.rows, ...partial.rows];
  root.innerHTML =
    pageHeader(
      "Payment reminders",
      "Review outstanding invoices and prepare a reminder to share yourself.",
      "",
      "COLLECTIONS",
    ) +
    '<div class="inline-note info">No messages are sent automatically. You can copy a reminder and share it with the customer.</div><div class="panel">' +
    (rows.length
      ? `<div class="table-scroll"><table><thead><tr><th>Invoice</th><th>Date</th><th>Customer</th><th class="number">Balance due</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr><td><a href="/invoices/${r.id}">${esc(r.number)}</a></td><td>${displayDate(r.invoice_date)}</td><td>${esc(r.customer_name)}</td><td class="number">${money(r.balance)}</td><td><button class="small" data-remind="${r.id}">Prepare reminder</button></td></tr>`).join("")}</tbody></table></div>`
      : empty("No outstanding invoices")) +
    '</div><p class="help">Showing up to 400 records. Use the Outstanding Payments report for a full date-filtered list.</p>';
  $$("[data-remind]", root).forEach(
    (b) =>
      (b.onclick = () => {
        const r = rows.find((x) => x.id === b.dataset.remind);
        const message = `Dear ${r.customer_name}, a reminder that ${money(r.balance)} remains due on invoice ${r.number} dated ${displayDate(r.invoice_date)}. Please arrange payment. Thank you, ${state.settings.business_name}.`;
        const el = modal(
          "Payment reminder",
          `<textarea class="reminder-text" aria-label="Reminder message">${esc(message)}</textarea>`,
          {
            save: "Copy reminder",
            onSave: async () => {
              await navigator.clipboard.writeText($("textarea", el).value);
              toast("Reminder copied");
            },
          },
        );
      }),
  );
}
