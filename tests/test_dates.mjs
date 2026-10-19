import test from "node:test";
import assert from "node:assert/strict";
import {
  displayDate,
  parseDate,
  displayDateTime,
  reportDate,
} from "../frontend/dates.js";
import { dateInput, dateValue } from "../frontend/core.js";
import { calendarMonth } from "../frontend/calendar.js";

test("day/month/year round trip does not swap month and day", () => {
  assert.equal(displayDate("2026-10-07"), "07/10/2026");
  assert.equal(parseDate("07/10/2026"), "2026-10-07");
  assert.equal(parseDate("29/02/2024"), "2024-02-29");
  assert.equal(parseDate(""), "");
  assert.equal(
    displayDateTime("2026-10-07T18:06:09+00:00"),
    "07/10/2026 18:06:09",
  );
  assert.equal(reportDate("daily", "label", "2026-10-07"), "07/10/2026");
  assert.equal(reportDate("monthly", "label", "2026-10"), "10/2026");
});

test("impossible, ambiguous and out-of-range dates are rejected", () => {
  for (const value of [
    "29/02/2026",
    "31/04/2026",
    "10/19/2026",
    "7/10/2026",
    "2026-10-07",
    "00/10/2026",
    "01/01/1899",
    "01/01/2200",
  ])
    assert.throws(() => parseDate(value), /dd\/mm\/yyyy/);
  let validity = "";
  const input = {
    value: "31/04/2026",
    required: true,
    setCustomValidity: (message) => {
      validity = message;
    },
  };
  assert.throws(() => dateValue(input));
  assert.ok(validity);
  input.value = "30/04/2026";
  assert.equal(dateValue(input), "2026-04-30");
  assert.equal(validity, "");
  input.value = "";
  assert.throws(() => dateValue(input));
  input.required = false;
  assert.equal(dateValue(input), "");
});

test("date entry explicitly uses dd/mm/yyyy regardless of browser locale", () => {
  const html = dateInput("invoice_date", "2026-10-07", {
    required: true,
    label: "Invoice date",
  });
  assert.match(html, /type="text"/);
  assert.match(html, /value="07\/10\/2026"/);
  assert.match(html, /placeholder="dd\/mm\/yyyy"/);
  assert.match(html, /required/);
});

test("calendar handles leap years, month lengths and Monday-first alignment", () => {
  assert.equal(calendarMonth(2024, 1).days.length, 29);
  assert.equal(calendarMonth(1900, 1).days.length, 28);
  assert.equal(calendarMonth(2000, 1).days.length, 29);
  assert.equal(calendarMonth(2026, 3).days.length, 30);
  const october = calendarMonth(2026, 9);
  assert.equal(october.offset, 3);
  assert.deepEqual(october.days[6], { day: 7, iso: "2026-10-07" });
  assert.equal(october.days[30].iso, "2026-10-31");
  assert.throws(() => calendarMonth(1899, 1), RangeError);
  assert.throws(() => calendarMonth(2026, 12), RangeError);
});

test("invoice dates have a separate calendar button without submitting the form", () => {
  const html = dateInput("invoice_date", "2026-10-07", {
    label: "Invoice date",
    calendar: true,
  });
  assert.match(html, /type="button"[^>]*data-calendar/);
  assert.match(html, /aria-label="Open Invoice date calendar"/);
  assert.match(html, /aria-haspopup="dialog"/);
  assert.match(html, /value="07\/10\/2026"/);
});
