import {
  state,
  $,
  $$,
  esc,
  money,
  amount,
  today,
  debounce,
  icon,
  field,
  pageHeader,
  toast,
  api,
  autocomplete,
  confirmLeave,
  printInvoice,
} from "./core.js";
import { customerModal } from "./pages.js";

const STORAGE = "svs.invoice.draft.v1";
const blank = () => ({
  description: "",
  quantity: "1",
  rate: "",
  gst_rate: state.settings.default_gst,
  discount_percent: "0",
  unit: "Nos",
  hsn: "",
  item_id: null,
});

export async function invoiceEditor(
  root,
  id = null,
  params = new URLSearchParams(),
) {
  let doc = {
    id: null,
    version: null,
    number: null,
    status: "Draft",
    customer_id: "",
    customer_snapshot: null,
    invoice_date: today(),
    due_date: "",
    terms: state.settings.terms,
    notes: "",
    lines: [blank(), blank(), blank()],
  };
  let dirty = false,
    revision = 0,
    calculating = 0,
    activeSave = null,
    manualSave = false,
    finished = false,
    storageWarned = false;
  const fromInvoice = (d) => ({
    ...d,
    lines: d.lines.map((l) => ({
      item_id: l.item_id,
      description: l.description,
      quantity: l.quantity,
      rate: amount(l.unit_price),
      gst_rate: l.gst_rate,
      discount_percent: l.discount_percent,
      unit: l.unit,
      hsn: l.hsn,
    })),
    due_date: d.due_date || "",
  });
  if (id) doc = fromInvoice(await api("/api/invoices/" + id));
  if (params.get("duplicate")) {
    const source = fromInvoice(
      await api("/api/invoices/" + params.get("duplicate")),
    );
    doc = {
      ...source,
      id: null,
      version: null,
      number: null,
      status: "Draft",
      invoice_date: today(),
      due_date: "",
      notes: source.notes,
    };
    dirty = true;
  }
  if (params.get("customer")) {
    const c = await api("/api/customers/" + params.get("customer"));
    doc.customer_id = c.id;
    doc.customer_snapshot = c;
  }
  if (doc.status === "Cancelled" || doc.historical)
    throw new Error("This invoice cannot be edited");
  let recover = null;
  try {
    const old = JSON.parse(localStorage.getItem(STORAGE) || "null");
    if (!id && !params.size && old && Date.now() - old.savedAt < 7 * 86400000)
      recover = old.doc;
  } catch {}
  function stash() {
    try {
      localStorage.setItem(
        STORAGE,
        JSON.stringify({ doc, savedAt: Date.now() }),
      );
    } catch {
      if (!storageWarned) {
        toast(
          "Browser draft storage is unavailable. Save a server draft regularly.",
          true,
        );
        storageWarned = true;
      }
    }
  }
  const notify = () => {
    revision++;
    dirty = true;
    stash();
    $(".save-state", root).innerHTML = icon("history") + "Unsaved changes";
    scheduleCalculation();
    if (doc.status === "Draft") scheduleAutosave();
  };
  const scheduleAutosave = debounce(() => {
    if (!finished && !manualSave && doc.status === "Draft" && ready()) {
      save(false, { automatic: true }).catch(() => {});
    }
  }, 1400);
  const scheduleCalculation = debounce(() => calculate(), 220);
  function linesForSave() {
    const lines = doc.lines.filter((l) => l.description.trim());
    return lines.map((l) => ({
      item_id: l.item_id,
      description: l.description,
      quantity: l.quantity,
      rate: l.rate,
      gst_rate: l.gst_rate,
      discount_percent: l.discount_percent || "0",
      unit: l.unit,
      hsn: l.hsn,
    }));
  }
  function ready() {
    return (
      !!doc.customer_id &&
      linesForSave().length > 0 &&
      linesForSave().every(
        (l) =>
          l.quantity &&
          l.rate !== "" &&
          +l.quantity > 0 &&
          Number.isFinite(+l.quantity) &&
          Number.isFinite(+l.rate) &&
          +l.rate >= 0,
      )
    );
  }
  async function calculate() {
    const seq = ++calculating;
    const lines = linesForSave();
    if (!lines.length) {
      $("#invoice-totals", root).innerHTML = summary(null);
      $$("[data-amount]", root).forEach((e) => (e.textContent = "—"));
      $$("[data-taxable]", root).forEach((e) => (e.textContent = "—"));
      return;
    }
    try {
      const preview = lines.map((l) => ({
        ...l,
        quantity: l.quantity || "0",
        rate: l.rate || "0",
      }));
      const d = await api("/api/calculate", {
        method: "POST",
        body: { lines: preview },
      });
      if (seq !== calculating || !root.isConnected) return;
      $("#invoice-totals", root).innerHTML = summary(d);
      let n = 0;
      doc.lines.forEach((line, i) => {
        const result = line.description.trim() ? d.lines[n++] : null;
        const gross = $(`[data-amount="${i}"]`, root),
          base = $(`[data-taxable="${i}"]`, root);
        if (gross) gross.textContent = result ? money(result.amount) : "—";
        if (base) base.textContent = result ? money(result.taxable) : "—";
      });
      $("#calculation-error", root).textContent = "";
    } catch (error) {
      if (seq !== calculating) return;
      $("#calculation-error", root).textContent = error.message;
      $("#invoice-totals", root).innerHTML =
        '<p class="help">Correct the item inputs to calculate totals.</p>';
    }
  }
  function summary(d) {
    return `<div><span>Taxable total</span><strong>${money(d?.taxable)}</strong></div>${d?.tax_groups?.length ? d.tax_groups.map((g) => `<div><span>CGST ${+g.gst_rate / 2}%</span><strong>${money(g.cgst)}</strong></div><div><span>SGST ${+g.gst_rate / 2}%</span><strong>${money(g.sgst)}</strong></div>`).join("") : `<div><span>CGST</span><strong>${money(0)}</strong></div><div><span>SGST</span><strong>${money(0)}</strong></div>`}${d?.rounding ? `<div><span>Rounding adjustment</span><strong>${money(d.rounding)}</strong></div>` : ""}<div class="grand"><span>Grand total</span><span>${money(d?.total)}</span></div>`;
  }
  function customerDisplay() {
    const c = doc.customer_snapshot;
    $("#invoice-customer", root).value = c?.name || "";
    $("#customer-details", root).textContent = c
      ? [
          c.place,
          [c.city, c.state, c.pincode].filter(Boolean).join(", "),
          [c.phone, c.gstin ? "GSTIN: " + c.gstin : ""]
            .filter(Boolean)
            .join(" · "),
        ]
          .filter(Boolean)
          .join("\n")
      : "Select a customer to populate billing details.";
  }
  function render() {
    root.innerHTML =
      pageHeader(
        doc.number ? "Edit invoice " + doc.number : "New invoice",
        "GST-inclusive rates · customer and item details are saved with each invoice.",
        `<a href="/invoices"><button>Invoice history</button></a>`,
        "SALES / TAX INVOICE",
      ) +
      `${recover ? '<div class="inline-note info" id="restore-banner">A previous invoice draft is available on this browser. <button class="small" id="restore-draft">Restore draft</button> <button class="small" id="discard-draft">Discard</button></div>' : ""}<div class="panel" id="invoice-editor"><div class="panel-body"><div class="invoice-meta"><div class="field"><span>Bill to customer</span><div class="customer-search-line"><div class="autocomplete"><input id="invoice-customer" placeholder="Start typing a customer name…" autocomplete="off" aria-label="Search customer"></div><button type="button" id="inline-customer" title="Add customer" aria-label="Add new customer">${icon("plus")}</button></div><div id="customer-details" class="customer-details"></div></div>${field("Invoice date", "invoice_date", doc.invoice_date, { type: "date", required: true })}${field("Payment due (optional)", "due_date", doc.due_date, { type: "date" })}</div></div><div class="table-scroll"><table class="invoice-table"><thead><tr><th>Sl.</th><th>Description of goods</th>${state.settings.show_hsn ? "<th>HSN</th>" : ""}<th class="number">Quantity</th><th class="number">Rate (₹)</th>${state.settings.enable_discounts ? "<th>Discount %</th>" : ""}<th class="number">Amount</th>${state.settings.show_taxable ? `<th class="number">${state.settings.legacy_labels ? "Discount" : "Taxable value"}</th>` : ""}<th></th></tr></thead><tbody id="invoice-rows"></tbody></table></div><div class="panel-body" style="padding:12px 20px"><button class="small" id="add-line">${icon("plus")}Add item</button><span class="help" style="margin-left:10px">Rates include GST. Item descriptions are editable.</span><div class="modal-error" id="calculation-error" style="margin:10px 0 0"></div></div><div class="invoice-bottom"><div><div class="field"><span>Terms</span><textarea name="terms" maxlength="3000">${esc(doc.terms)}</textarea></div><div class="field" style="margin-top:14px"><span>Internal notes (not printed)</span><textarea name="notes" maxlength="3000" placeholder="Optional notes for your records…">${esc(doc.notes)}</textarea></div></div><div class="totals" id="invoice-totals">${summary(null)}</div></div><div class="invoice-footer"><span class="save-state">${icon("check")}${doc.id ? "Saved draft loaded" : "New invoice · auto-save begins after customer and items are entered"}</span><div class="actions"><button class="save-invoice" id="save-draft">${icon("history")}${doc.status === "Draft" ? "Save draft" : "Save changes"}</button><button class="save-invoice" id="preview-pdf">Preview PDF</button><button class="save-invoice primary" id="save-final">${icon("check")}${doc.status === "Draft" ? "Save invoice" : "Save changes"}</button><button class="save-invoice primary" id="save-print">${icon("print")}Save & print</button></div></div></div><div class="keyboard-strip"><span><kbd>Enter</kbd>Next field</span><span><kbd>↑ ↓</kbd>Search results</span><span><kbd>Ctrl S</kbd>Save</span><span><kbd>Ctrl Enter</kbd>Save & print</span><span><kbd>Ctrl P</kbd>Print PDF</span><span><kbd>Alt N</kbd>New invoice</span></div>`;
    customerDisplay();
    autocomplete($("#invoice-customer", root), {
      kind: "customers",
      onSelect: (c) => {
        doc.customer_id = c.id;
        doc.customer_snapshot = c;
        customerDisplay();
        notify();
        $('[data-line="0"][data-field="description"]', root)?.focus();
      },
    });
    $("#invoice-customer", root).addEventListener("input", () => {
      doc.customer_id = "";
      doc.customer_snapshot = null;
      $("#customer-details", root).textContent =
        "Select a matching customer, or use + to add one.";
      notify();
    });
    $("#inline-customer", root).onclick = () =>
      customerModal(null, (c) => {
        doc.customer_id = c.id;
        doc.customer_snapshot = c;
        customerDisplay();
        notify();
        $('[data-line="0"][data-field="description"]', root)?.focus();
      });
    for (const key of ["invoice_date", "due_date", "terms", "notes"])
      $(`[name="${key}"]`, root).oninput = (e) => {
        doc[key] = e.target.value;
        notify();
      };
    $("#add-line", root).onclick = () => addLine();
    $("#save-draft", root).onclick = () =>
      save(doc.status !== "Draft", { navigate: true }).catch((e) =>
        toast(e.message, true),
      );
    $("#save-final", root).onclick = () =>
      save(true, { navigate: true }).catch((e) => toast(e.message, true));
    $("#save-print", root).onclick = () =>
      save(true, { print: true, navigate: true }).catch((e) =>
        toast(e.message, true),
      );
    $("#preview-pdf", root).onclick = () =>
      save(false, { preview: true }).catch((e) => toast(e.message, true));
    $("#restore-draft", root)?.addEventListener("click", async () => {
      try {
        if (recover.id) {
          const saved = await api("/api/invoices/" + recover.id);
          if (saved.status !== "Draft") {
            toast("That invoice was already finalized. Opening it.");
            localStorage.removeItem(STORAGE);
            dirty = false;
            state.navigate("/invoices/" + saved.id);
            return;
          }
          recover.version = saved.version;
        }
        doc = recover;
        recover = null;
        dirty = true;
        render();
        calculate();
      } catch (error) {
        toast(error.message, true);
      }
    });
    $("#discard-draft", root)?.addEventListener("click", () => {
      recover = null;
      localStorage.removeItem(STORAGE);
      $("#restore-banner", root).remove();
    });
    renderRows();
    calculate();
  }
  function renderRows() {
    const tbody = $("#invoice-rows", root);
    tbody.innerHTML = doc.lines
      .map(
        (line, i) =>
          `<tr><td class="muted small-type">${i + 1}</td><td class="description-cell"><div class="autocomplete"><input data-line="${i}" data-field="description" value="${esc(line.description)}" placeholder="Search item or enter description…" aria-label="Item ${i + 1} description" maxlength="500" autocomplete="off"></div><p class="help">GST <input data-line="${i}" data-field="gst_rate" value="${esc(line.gst_rate)}" aria-label="Item ${i + 1} GST rate" type="number" step=".01" min="0" max="100" style="width:50px;padding:2px 3px;font-size:10px">% · ${esc(line.unit)}</p></td>${state.settings.show_hsn ? `<td><input data-line="${i}" data-field="hsn" value="${esc(line.hsn)}" aria-label="Item ${i + 1} HSN" style="width:70px" maxlength="30"></td>` : ""}<td class="qty-cell"><input data-line="${i}" data-field="quantity" type="number" value="${esc(line.quantity)}" min=".001" step=".001" aria-label="Item ${i + 1} quantity" class="number"></td><td class="rate-cell"><input data-line="${i}" data-field="rate" type="number" value="${esc(line.rate)}" min="0" step=".01" aria-label="Item ${i + 1} rate" class="number" placeholder="0.00"></td>${state.settings.enable_discounts ? `<td><input data-line="${i}" data-field="discount_percent" type="number" min="0" max="100" step=".01" value="${esc(line.discount_percent)}" aria-label="Item ${i + 1} discount" style="width:70px"></td>` : ""}<td class="number amount-cell" data-amount="${i}">—</td>${state.settings.show_taxable ? `<td class="number muted tax-cell" data-taxable="${i}">—</td>` : ""}<td class="row-actions-cell"><div class="row-actions"><button class="icon-button" data-copy-line="${i}" aria-label="Duplicate item ${i + 1}" title="Duplicate row">${icon("copy")}</button><button class="icon-button" data-delete-line="${i}" aria-label="Remove item ${i + 1}" title="Remove row">${icon("close")}</button></div></td></tr>`,
      )
      .join("");
    $$("[data-field]", tbody).forEach((input) => {
      const i = +input.dataset.line,
        key = input.dataset.field;
      input.addEventListener("input", () => {
        doc.lines[i][key] = input.value;
        if (key === "description") doc.lines[i].item_id = null;
        notify();
      });
      if (["quantity", "rate", "discount_percent"].includes(key))
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (key === "quantity")
              $(`[data-line="${i}"][data-field="rate"]`, root).focus();
            else nextRow(i);
          }
        });
    });
    $$('[data-field="description"]', tbody).forEach((input) => {
      const i = +input.dataset.line;
      autocomplete(input, {
        kind: "items",
        onSelect: (item) => {
          doc.lines[i] = {
            ...doc.lines[i],
            item_id: item.id,
            description: item.name,
            rate: item.default_rate === null ? "" : amount(item.default_rate),
            gst_rate: item.gst_rate,
            unit: item.unit,
            hsn: item.hsn,
          };
          renderRows();
          notify();
          $(`[data-line="${i}"][data-field="quantity"]`, root).focus();
          $(`[data-line="${i}"][data-field="quantity"]`, root).select();
        },
        onCustom: () => {
          $(`[data-line="${i}"][data-field="quantity"]`, root).focus();
          $(`[data-line="${i}"][data-field="quantity"]`, root).select();
        },
      });
    });
    $$("[data-delete-line]", tbody).forEach(
      (button) =>
        (button.onclick = () => {
          doc.lines.splice(+button.dataset.deleteLine, 1);
          if (!doc.lines.length) doc.lines.push(blank());
          renderRows();
          notify();
        }),
    );
    $$("[data-copy-line]", tbody).forEach(
      (button) =>
        (button.onclick = () => {
          if (doc.lines.length >= 500) {
            toast("Maximum 500 items per invoice", true);
            return;
          }
          const i = +button.dataset.copyLine;
          doc.lines.splice(i + 1, 0, { ...doc.lines[i] });
          renderRows();
          notify();
        }),
    );
    scheduleCalculation();
  }
  function addLine() {
    if (doc.lines.length >= 500) {
      toast("Maximum 500 items per invoice", true);
      return;
    }
    doc.lines.push(blank());
    renderRows();
    $(
      `[data-line="${doc.lines.length - 1}"][data-field="description"]`,
      root,
    ).focus();
    notify();
  }
  function nextRow(index) {
    if (index === doc.lines.length - 1) addLine();
    else
      $(`[data-line="${index + 1}"][data-field="description"]`, root).focus();
  }
  async function save(
    finalize,
    {
      automatic = false,
      print = false,
      preview = false,
      navigate = false,
    } = {},
  ) {
    if (manualSave && !automatic) return;
    if (!ready()) {
      if (automatic) return;
      throw new Error(
        "Select a customer and enter at least one complete item with quantity and rate",
      );
    }
    const popup =
      print || preview ? window.open("about:blank", "_blank") : null;
    if (activeSave) {
      await activeSave;
      if (finished) return;
    }
    if (!automatic) manualSave = true;
    const rev = revision;
    const run = async () => {
      const payload = {
        customer_id: doc.customer_id,
        invoice_date: doc.invoice_date,
        due_date: doc.due_date || null,
        terms: doc.terms,
        notes: doc.notes,
        lines: linesForSave(),
        finalize: finalize || doc.status !== "Draft",
        version: doc.version,
      };
      if (!automatic)
        $$("input,textarea,button", $("#invoice-editor", root)).forEach(
          (e) => (e.disabled = true),
        );
      $(".save-state", root).textContent = automatic
        ? "Saving draft…"
        : "Saving invoice…";
      try {
        const result = await api(
          "/api/invoices" + (doc.id ? "/" + doc.id : ""),
          { method: doc.id ? "PUT" : "POST", body: payload },
        );
        doc.id = result.id;
        doc.version = result.version;
        doc.number = result.number;
        doc.status = result.status;
        if (finished) return result;
        dirty = rev !== revision;
        stash();
        $(".save-state", root).innerHTML =
          icon("check") +
          (dirty
            ? "Changes pending…"
            : "Saved " +
              new Date().toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              }));
        if (!automatic) toast(finalize ? "Invoice saved" : "Draft saved");
        if (print) {
          printInvoice(doc.id, popup);
        } else if (preview) {
          if (popup)
            popup.location.href = `/api/invoices/${doc.id}/pdf?download=false`;
          else
            toast(
              "Allow popups or use Download PDF from Invoice History.",
              true,
            );
        }
        if (navigate) {
          finished = true;
          dirty = false;
          localStorage.removeItem(STORAGE);
          state.guard = null;
          state.navigate("/invoices/" + doc.id);
        } else if (dirty && doc.status === "Draft") scheduleAutosave();
        return result;
      } catch (error) {
        if (popup) popup.close();
        $(".save-state", root).textContent = "Could not save: " + error.message;
        if (automatic) toast("Draft auto-save failed: " + error.message, true);
        throw error;
      } finally {
        if (!automatic && root.isConnected)
          $$("input,textarea,button", $("#invoice-editor", root)).forEach(
            (e) => (e.disabled = false),
          );
        manualSave = false;
        activeSave = null;
      }
    };
    activeSave = run();
    return activeSave;
  }
  state.dispose = () => {
    finished = true;
  };
  state.guard = async () => {
    if (manualSave) {
      toast("Please wait for the invoice to finish saving");
      return false;
    }
    if (!dirty) return true;
    return confirmLeave();
  };
  state.hasUnsaved = () => dirty && !finished;
  state.invoiceKeys = (event) => {
    const command = event.ctrlKey || event.metaKey;
    if (command && event.key.toLowerCase() === "s") {
      event.preventDefault();
      save(true, { navigate: true }).catch((e) => toast(e.message, true));
    } else if (command && event.key === "Enter") {
      event.preventDefault();
      save(true, { print: true, navigate: true }).catch((e) =>
        toast(e.message, true),
      );
    } else if (command && event.key.toLowerCase() === "p") {
      event.preventDefault();
      save(false, { print: true }).catch((e) => toast(e.message, true));
    }
  };
  render();
}

export function clearBrowserDraft() {
  localStorage.removeItem(STORAGE);
}
