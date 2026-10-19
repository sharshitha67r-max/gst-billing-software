from pydantic import BaseModel, Field, ConfigDict
from typing import Literal


class Payload(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(Payload):
    email: str = Field(max_length=254)
    password: str = Field(min_length=1, max_length=256)


class Customer(Payload):
    name: str = Field(min_length=1, max_length=200)
    place: str = Field(default="", max_length=1000)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    pincode: str = Field(default="", max_length=20)
    phone: str = Field(default="", max_length=80)
    gstin: str = Field(default="", max_length=30)
    email: str = Field(default="", max_length=254)
    notes: str = Field(default="", max_length=3000)
    active: bool = True


class Item(Payload):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    name: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=1000)
    default_rate: str | None = Field(default=None, max_length=30)
    gst_rate: str = Field(default="18", max_length=20)
    unit: str = Field(default="Nos", min_length=1, max_length=30)
    hsn: str = Field(default="", max_length=30)
    active: bool = True


class Line(Payload):
    item_id: str | None = None
    description: str = Field(min_length=1, max_length=500)
    quantity: str = Field(default="1", max_length=30)
    rate: str = Field(default="0", max_length=30)
    gst_rate: str = Field(default="18", max_length=20)
    discount_percent: str = Field(default="0", max_length=20)
    unit: str = Field(default="Nos", max_length=30)
    hsn: str = Field(default="", max_length=30)


class Invoice(Payload):
    customer_id: str | None
    invoice_date: str = Field(max_length=10)
    due_date: str | None = Field(default=None, max_length=10)
    lines: list[Line] = Field(min_length=1, max_length=500)
    terms: str = Field(default="", max_length=3000)
    notes: str = Field(default="", max_length=3000)
    finalize: bool = False
    version: int | None = Field(default=None, ge=1)


class Calculation(Payload):
    lines: list[Line] = Field(min_length=1, max_length=500)


class Payment(Payload):
    invoice_id: str
    payment_date: str = Field(max_length=10)
    amount: str = Field(max_length=30)
    method: str = Field(max_length=30)
    reference: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)
    idempotency_key: str = Field(min_length=16, max_length=80)


class ImportCommit(Payload):
    preview_id: str
    selected: list[int] = Field(max_length=10000)


class Reason(Payload):
    reason: str = Field(min_length=3, max_length=1000)


class BackupConfirm(Payload):
    preview_id: str
    confirmation: str


class DeleteConfirm(Payload):
    confirmation: Literal["DELETE"]
