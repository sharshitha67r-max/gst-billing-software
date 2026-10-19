// Keep ISO dates in records and use an unambiguous day/month/year in the UI.
export function displayDate(value) {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

export function parseDate(value) {
  const text = value.trim();
  if (!text) return "";
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (match) {
    const [, day, month, year] = match;
    const date = new Date(Date.UTC(+year, +month - 1, +day));
    if (
      +year >= 1900 &&
      +year <= 2199 &&
      date.getUTCFullYear() === +year &&
      date.getUTCMonth() === +month - 1 &&
      date.getUTCDate() === +day
    )
      return `${year}-${month}-${day}`;
  }
  throw new Error("Enter a valid date as dd/mm/yyyy, for example 07/10/2026");
}

export const displayDateTime = (value) =>
  value ? displayDate(value.slice(0, 10)) + " " + value.slice(11, 19) : "—";

export function reportDate(kind, key, value) {
  if (
    key === "date" ||
    key === "due_date" ||
    (key === "label" && kind === "daily")
  )
    return displayDate(value);
  if (key === "label" && ["monthly", "gst"].includes(kind) && value)
    return value.slice(5, 7) + "/" + value.slice(0, 4);
  return value ?? "—";
}
