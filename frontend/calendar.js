import { displayDate, parseDate } from "./dates.js?v=20261019-sidebar-calendar";

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
let closeOpenCalendar = null;
export function closeCalendar() {
  closeOpenCalendar?.();
}

export function calendarMonth(year, month) {
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2199 ||
    !Number.isInteger(month) ||
    month < 0 ||
    month > 11
  )
    throw new RangeError("Invalid calendar month");
  return {
    offset: (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7,
    days: Array.from(
      { length: new Date(Date.UTC(year, month + 1, 0)).getUTCDate() },
      (_, i) => ({
        day: i + 1,
        iso: `${year}-${String(month + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`,
      }),
    ),
  };
}

export function bindCalendar(input, button, today) {
  button.onclick = () => {
    if (button.getAttribute("aria-expanded") === "true")
      return closeOpenCalendar?.();
    closeOpenCalendar?.();
    let selected = "";
    try {
      selected = parseDate(input.value);
    } catch {}
    const current = today();
    let [year, month] = (selected || current).split("-").map(Number);
    month -= 1;
    const popup = document.createElement("div");
    popup.className = "date-calendar";
    popup.setAttribute("role", "dialog");
    popup.setAttribute(
      "aria-label",
      `${input.getAttribute("aria-label") || "Date"} calendar`,
    );
    button.setAttribute("aria-expanded", "true");
    document.body.append(popup);

    function close(focus = false) {
      popup.remove();
      button.setAttribute("aria-expanded", "false");
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
      document.removeEventListener("focusin", focusOutside);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      closeOpenCalendar = null;
      if (focus) button.focus();
    }
    function outside(e) {
      if (!popup.contains(e.target) && !button.contains(e.target)) close();
    }
    function focusOutside(e) {
      if (
        !popup.contains(e.target) &&
        !button.contains(e.target) &&
        e.target !== input
      )
        close();
    }
    function escape(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    }
    function reposition() {
      if (!input.isConnected) return close();
      const anchor = input.getBoundingClientRect(),
        box = popup.getBoundingClientRect();
      popup.style.left =
        Math.max(
          12,
          Math.min(
            anchor.right - box.width,
            window.innerWidth - box.width - 12,
          ),
        ) + "px";
      const below = anchor.bottom + 7,
        above = anchor.top - box.height - 7;
      popup.style.top =
        Math.max(
          12,
          below + box.height <= window.innerHeight - 12
            ? below
            : above >= 12
              ? above
              : window.innerHeight - box.height - 12,
        ) + "px";
    }
    function choose(value) {
      input.value = value ? displayDate(value) : "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      close();
      input.focus();
    }
    function move(amount) {
      const d = new Date(Date.UTC(year, month + amount, 1));
      if (d.getUTCFullYear() < 1900 || d.getUTCFullYear() > 2199) return;
      year = d.getUTCFullYear();
      month = d.getUTCMonth();
      render();
      popup
        .querySelector(amount < 0 ? "[data-previous]" : "[data-next]")
        .focus();
    }
    function render() {
      const grid = calendarMonth(year, month);
      popup.innerHTML = `<div class="calendar-heading"><button type="button" data-previous aria-label="Previous month" ${year === 1900 && month === 0 ? "disabled" : ""}>‹</button><select aria-label="Calendar month">${months.map((name, i) => `<option value="${i}" ${i === month ? "selected" : ""}>${name}</option>`).join("")}</select><select aria-label="Calendar year">${Array.from({ length: 300 }, (_, i) => `<option ${i + 1900 === year ? "selected" : ""}>${i + 1900}</option>`).join("")}</select><button type="button" data-next aria-label="Next month" ${year === 2199 && month === 11 ? "disabled" : ""}>›</button></div><div class="calendar-weekdays" aria-hidden="true">${["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((day) => `<span>${day}</span>`).join("")}</div><div class="calendar-days">${"<span></span>".repeat(grid.offset)}${grid.days.map(({ day, iso }) => `<button type="button" data-day="${iso}" aria-label="${displayDate(iso)}" aria-pressed="${iso === selected}" class="${iso === current ? "calendar-today" : ""}">${day}</button>`).join("")}</div><div class="calendar-footer"><button type="button" data-today>Today</button><button type="button" data-clear>Clear date</button><button type="button" data-close-calendar>Close</button></div>`;
      popup.querySelector("[data-previous]").onclick = () => move(-1);
      popup.querySelector("[data-next]").onclick = () => move(1);
      popup.querySelector("[aria-label='Calendar month']").onchange = (e) => {
        month = +e.target.value;
        render();
        popup.querySelector("[aria-label='Calendar month']").focus();
      };
      popup.querySelector("[aria-label='Calendar year']").onchange = (e) => {
        year = +e.target.value;
        render();
        popup.querySelector("[aria-label='Calendar year']").focus();
      };
      popup.querySelectorAll("[data-day]").forEach((day) => {
        day.onclick = () => choose(day.dataset.day);
      });
      popup.querySelector("[data-today]").onclick = () => choose(current);
      popup.querySelector("[data-clear]").onclick = () => choose("");
      popup.querySelector("[data-close-calendar]").onclick = () => close(true);
      reposition();
    }
    closeOpenCalendar = close;
    render();
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    document.addEventListener("focusin", focusOutside);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    (
      popup.querySelector("[aria-pressed=true]") ||
      popup.querySelector("[data-today]")
    ).focus();
  };
}
