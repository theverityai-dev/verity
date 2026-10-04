# Role Capability Matrix

| Role | CRM | Sales | Procurement | Inventory | Work | Quality | Finance | Reports | Admin |
|---|---|---|---|---|---|---|---|---|---|
| Field Worker | — | — | — | Read | Own | Submit | — | Own | — |
| Supervisor | Read | Read | Read | Read | Team | Approve | Read | Team | — |
| Sales | Write | Write | Read | Read | Read | Read | Read | Sales | — |
| Procurement | Read | Read | Write | Receipt | Read | Read | Read | Procurement | — |
| Warehouse | Read | Read | Read | Write | Read | Read | — | Inventory | — |
| Quality | Read | Read | Read | Read | Read | Write | Read | Quality | — |
| Finance | Read | Read | Read | Read | Read | Read | Write | Finance | — |
| Ops Manager | Read | Read | Read | Read | Write | Write | Read | All ops | — |
| Admin | Config | Config | Config | Config | Config | Config | Config | Config | Write |

Exact permissions must map onto Verity's authorization model; page hiding alone is never sufficient.
