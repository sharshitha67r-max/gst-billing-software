"""Presentation dates; persisted values and API dates remain ISO 8601."""
from datetime import date


def display_date(value):
    return date.fromisoformat(value).strftime("%d/%m/%Y") if value else ""


def report_date(kind, key, value, excel=False):
    if not value:
        return value
    if key in {"date", "due_date"} or (key == "label" and kind == "daily"):
        return date.fromisoformat(value) if excel else display_date(value)
    if key == "label" and kind in {"monthly", "gst"}:
        return value[5:7] + "/" + value[:4]
    return value
