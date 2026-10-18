/**
 * The one place a platform identifier becomes a business word.
 *
 * §78 wants an audit a business can read: who did what, to which record, when,
 * and what changed. `state`, `verity.trading.receive_goods` and
 * `verity.trading.purchase_order` answer none of that for the person asking.
 *
 * Shared between the audit page and the per-record activity panels, because two
 * copies of a vocabulary drift and the first symptom is the same event
 * described two ways on two screens — which is the inconsistency §84 is
 * written against, appearing in the log that is supposed to explain it.
 *
 * Every lookup falls through to the raw identifier rather than hiding a row it
 * cannot name. A change that happened and cannot be described is still a change
 * that happened, and dropping it would make the log quietly incomplete —
 * exactly the property an audit trail must not have.
 *
 * ADR-018 renamed most of these `verity.plywood.*` keys to `verity.trading.*`
 * going forward. Existing `Activity`/`DomainEvent` history keeps its old key —
 * append-only, never rewritten (same principle as the ledger tables
 * themselves) — so both are mapped to the same label here, permanently.
 */

/** Entity keys as a record type a person would name. */
export const ENTITY_LABEL: Record<string, string> = {
  "verity.trading.purchase_order": "Purchase order",
  "verity.trading.sales_order": "Sales order",
  "verity.trading.invoice": "Invoice",
  "verity.trading.payment": "Payment",
  "verity.trading.product": "Board",
  "verity.trading.brand": "Brand",
  "verity.trading.supplier": "Supplier",
  "verity.trading.customer": "Customer",
  "verity.trading.supplier_price": "Supplier price",
  "verity.trading.customer_price": "Customer price",
  "verity.trading.stock_balance": "Stock",
  "verity.trading.stock_ledger": "Stock movement",
  "verity.trading.godown_rack": "Rack",
  "verity.trading.business_profile": "Business details",
  "verity.trading.gst_registration": "Tax registration",
  "verity.trading.accounting_period": "Accounting period",
  "verity.trading.ledger_entry": "Ledger entry",
  "verity.plywood.product_detail": "Board specification",
  // Historical (pre-ADR-018) keys — Activity/DomainEvent rows recorded under
  // these before the rename stay readable; never remove.
  "verity.plywood.purchase_order": "Purchase order",
  "verity.plywood.sales_order": "Sales order",
  "verity.plywood.invoice": "Invoice",
  "verity.plywood.payment": "Payment",
  "verity.plywood.product": "Board",
  "verity.plywood.brand": "Brand",
  "verity.plywood.supplier": "Supplier",
  "verity.plywood.customer": "Customer",
  "verity.plywood.supplier_price": "Supplier price",
  "verity.plywood.customer_price": "Customer price",
  "verity.plywood.stock_balance": "Stock",
  "verity.plywood.stock_ledger": "Stock movement",
  "verity.plywood.godown_rack": "Rack",
  "verity.plywood.business_profile": "Business details",
  "verity.plywood.gst_registration": "Tax registration",
  "verity.plywood.accounting_period": "Accounting period",
  "verity.plywood.ledger_entry": "Ledger entry",
  "verity.platform.role": "Role",
  "verity.platform.membership": "Person",
  "verity.platform.membership_access": "Person access",
  "verity.platform.organization": "Organization",
};

/** Column names as the business reads them. */
export const FIELD_LABEL: Record<string, string> = {
  state: "Status",
  totalCostPaise: "Order value",
  totalPricePaise: "Order value",
  qtyReceived: "Received quantity",
  qtyShipped: "Issued quantity",
  qtyOrdered: "Ordered quantity",
  creditLimitPaise: "Credit limit",
  creditOverrideReason: "Credit override",
  reorderLevelUnits: "Reorder level",
  negotiatedCostPaise: "Supplier price",
  customPricePaise: "Customer price",
  reference: "Reference",
  reason: "Reason",
  active: "Active",
  roleId: "Role",
  hsnCode: "HSN code",
  gstin: "GSTIN",
};

/** Command keys as the action they performed. */
export const COMMAND_LABEL: Record<string, string> = {
  "verity.trading.create_purchase_order": "Order raised",
  "verity.trading.submit_purchase_order": "Sent to supplier",
  "verity.trading.receive_goods": "Goods received",
  "verity.trading.cancel_purchase_order": "Order cancelled",
  "verity.trading.create_sales_order": "Order taken",
  "verity.trading.approve_credit": "Credit approved",
  "verity.trading.reserve_for_order": "Stock reserved",
  "verity.trading.dispatch_order": "Goods issued",
  "verity.trading.cancel_sales_order": "Order cancelled",
  "verity.trading.raise_sales_invoice": "Invoice raised",
  "verity.trading.raise_purchase_invoice": "Supplier invoice recorded",
  "verity.trading.raise_invoice_note": "Credit or debit note issued",
  "verity.trading.record_payment": "Payment recorded",
  "verity.trading.record_damaged_stock": "Damage recorded",
  "verity.trading.adjust_stock": "Stock adjusted",
  "verity.trading.record_returned_stock": "Customer return recorded",
  "verity.trading.transfer_stock": "Stock transferred",
  "verity.trading.set_supplier_price": "Supplier price set",
  "verity.trading.set_customer_price": "Customer price set",
  "verity.trading.set_credit_limit": "Credit limit set",
  "verity.trading.set_tax_rule": "Tax rate set",
  "verity.trading.close_period": "Period closed",
  "verity.trading.reopen_period": "Period reopened",
  "verity.trading.set_role_activity": "Role changed",
  "verity.trading.create_brand": "Brand added",
  "verity.trading.set_brand_active": "Brand availability changed",
  "verity.trading.create_customer": "Customer added",
  "verity.trading.edit_customer": "Customer edited",
  "verity.trading.remove_customer": "Customer removed",
  "verity.trading.create_supplier": "Supplier added",
  "verity.trading.edit_supplier": "Supplier edited",
  "verity.trading.remove_supplier": "Supplier removed",
  "verity.trading.link_supplier_to_customer": "Supplier linked to a customer",
  "verity.trading.edit_purchase_order": "Order amended",
  "verity.trading.receive_stock": "Stock received",
  "verity.trading.issue_stock": "Stock issued",
  "verity.trading.define_godown_rack": "Rack added",
  "verity.trading.set_godown_rack_active": "Rack availability changed",
  "verity.trading.raise_purchase_bill_from_order": "Supplier bill raised from the order",
  "verity.trading.confirm_purchase_bill": "Supplier bill confirmed",
  "verity.trading.set_price_sheet": "Price sheet set",
  "verity.trading.register_gst_registration": "Tax registration added",
  "verity.trading.set_business_profile": "Business details set",
  "verity.trading.import_gst_portal_records": "GST portal records imported",
  "verity.plywood.create_product": "Board added",
  "verity.plywood.edit_product": "Board edited",
  "verity.plywood.set_product_active": "Board availability changed",
  // Historical (pre-ADR-018) keys.
  "verity.plywood.create_purchase_order": "Order raised",
  "verity.plywood.submit_purchase_order": "Sent to supplier",
  "verity.plywood.receive_goods": "Goods received",
  "verity.plywood.cancel_purchase_order": "Order cancelled",
  "verity.plywood.create_sales_order": "Order taken",
  "verity.plywood.approve_credit": "Credit approved",
  "verity.plywood.reserve_for_order": "Stock reserved",
  "verity.plywood.dispatch_order": "Goods issued",
  "verity.plywood.cancel_sales_order": "Order cancelled",
  "verity.plywood.raise_sales_invoice": "Invoice raised",
  "verity.plywood.raise_purchase_invoice": "Supplier invoice recorded",
  "verity.plywood.raise_invoice_note": "Credit or debit note issued",
  "verity.plywood.record_payment": "Payment recorded",
  "verity.plywood.record_damaged_stock": "Damage recorded",
  "verity.plywood.adjust_stock": "Stock adjusted",
  "verity.plywood.record_returned_stock": "Customer return recorded",
  "verity.plywood.transfer_stock": "Stock transferred",
  "verity.plywood.set_supplier_price": "Supplier price set",
  "verity.plywood.set_customer_price": "Customer price set",
  "verity.plywood.set_credit_limit": "Credit limit set",
  "verity.plywood.set_tax_rule": "Tax rate set",
  "verity.plywood.close_period": "Period closed",
  "verity.plywood.reopen_period": "Period reopened",
  "verity.plywood.set_role_activity": "Role changed",
  "verity.plywood.create_brand": "Brand added",
  "verity.plywood.set_brand_active": "Brand availability changed",
  "verity.plywood.create_customer": "Customer added",
  "verity.plywood.edit_customer": "Customer edited",
  "verity.plywood.remove_customer": "Customer removed",
  "verity.plywood.create_supplier": "Supplier added",
  "verity.plywood.edit_supplier": "Supplier edited",
  "verity.plywood.remove_supplier": "Supplier removed",
  "verity.plywood.link_supplier_to_customer": "Supplier linked to a customer",
  "verity.plywood.edit_purchase_order": "Order amended",
  "verity.plywood.receive_stock": "Stock received",
  "verity.plywood.issue_stock": "Stock issued",
  "verity.plywood.define_godown_rack": "Rack added",
  "verity.plywood.set_godown_rack_active": "Rack availability changed",
  "verity.plywood.raise_purchase_bill_from_order": "Supplier bill raised from the order",
  "verity.plywood.confirm_purchase_bill": "Supplier bill confirmed",
  "verity.plywood.set_price_sheet": "Price sheet set",
  "verity.plywood.register_gst_registration": "Tax registration added",
  "verity.plywood.set_business_profile": "Business details set",
  "verity.plywood.import_gst_portal_records": "GST portal records imported",
  "verity.platform.invite_person": "Person invited",
  "verity.platform.assign_role": "Role assigned",
  "verity.platform.create_role": "Role created",
  "verity.platform.revoke_membership": "Access removed",
  "verity.platform.disable_membership": "Access disabled",
  "verity.platform.restore_membership": "Access restored",
};

export function entityLabelOf(entityKey: string): string {
  return (
    ENTITY_LABEL[entityKey] ?? entityKey.split(".").slice(-1)[0] ?? entityKey
  );
}

export function fieldLabelOf(field: string): string {
  return FIELD_LABEL[field] ?? field;
}

export function commandLabelOf(commandKey: string | null): string | null {
  if (!commandKey) return null;
  return COMMAND_LABEL[commandKey] ?? commandKey;
}
