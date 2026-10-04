# Procurement

## Entities
PurchaseRequisition, RequisitionLine, Supplier, PurchaseOrder, PurchaseOrderLine, Receipt, ReceiptLine.

## Rules
- Preserve referential integrity.
- Tenant-owned entities follow existing RLS conventions.
- Derived reports are recomputable.
- State history must not be hidden solely in arbitrary JSON.
