<!-- converted from Shirt_Factory_Developer_Requirement_Sheet.xlsx -->

## Sheet: Read Me
| SHIRT FACTORY MANAGEMENT SYSTEM — DEVELOPER REQUIREMENTS |  |
| --- | --- |
| Excel specification for a custom shirt-manufacturing workflow | Version 1.0 | Prepared 21-Oct-2026 |  |
| Section | Requirement / Instruction |
| Purpose | Build a mobile + computer friendly web-based system for a shirt manufacturing factory. This workbook is the functional brief for the developer, not a working software application. |
| Business context | Shirt manufacturing with Lot-wise production tracking, Bundle-wise slips, karigar/outside-unit tracking, process tracking, piece reconciliation, costing and reports. |
| Users | Owner, Manager, Supervisor, Store Manager. Implement role-based permissions on the server/backend; hiding a sheet/tab alone is not security. |
| Devices & language | Mobile and computer both. Interface should support Hindi + English (bilingual labels). Internet is available; online-first operation is acceptable. |
| Data migration | New system. No legacy register/Excel migration required at launch. |
| Fabric inward fields confirmed | Fabric Type, Meter, Invoice Number, Party/Supplier Name. Developer may add inward date, entry ID, rate/amount and remarks as recommended supporting fields. |
| Bundle rules confirmed | Every bundle gets a separate slip. Slip shows Bundle Number, Net Pieces, and Lot Name/Number. Bundle should be size-mix capable; do not force size-wise tracking in initial version. |
| Karigar wage rules confirmed | Both issue-based and returned/accepted-piece wage calculation methods are used. Must support configurable wage basis by process/karigar/transaction. Track issued, returned, good, rejected, short and rework quantities; advances and deductions are required. |
| Lot costing confirmed | Include Fabric, Cutting, Thread, Pasting, Collar & Cuff, Side Feed Up, Stitching, Button/Kaj, Printing/Embroidery, Finishing/Press, Packing, Transport/Other Expenses. Prevent double counting when an operation is already included in another rate. |
| Location tracking confirmed | Track both current process/stage and the named karigar/outside unit/location. |
| Quality / reconciliation confirmed | Short, Reject and Rework must be separate. Support splitting a Lot and linking/joining Lots while preserving source traceability and cost allocation. |
| Parallel work confirmed | A karigar can have multiple bundles, Lots and/or stages active at the same time. Every transaction must reference its own Lot + Bundle + process + karigar. |
| Recommended build approach | Responsive web app/PWA with secure login, database, audit trail, backups, QR/barcode-ready bundle slip (optional), export to Excel/PDF, and dashboard. |
| Important costing rule | Actual cost per good piece = total allocated Lot cost ÷ good finished pieces. Keep original quantity, rejects, rework, short and finished-good quantity visible; don't hide losses in the denominator. |
| Approval needed before build | Confirm process order, piece-level vs bundle-level tracking, wage-rate setup, how rejected/short pieces affect wages, advance recovery policy, and how Lot split/join costs should be allocated. Suggested defaults are marked in sheets. |
## Sheet: Requirements
| Functional Requirements |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Developer should map every requirement to a screen/API/database table and test it before delivery. |  |  |  |  |  |  |  |
| Req ID | Module / Screen | Requirement | Required fields / data | Business rule / validation | Priority | Owner / role | Acceptance test |
| FR-001 | Login & Users | Secure login and user management | User ID, name, mobile/email, role, active status, password reset | Server-side role permission checks; record created/updated by | Must | Owner | Unauthorized roles cannot access restricted data or actions. |
| FR-002 | Bilingual UI | Hindi + English labels | Language preference per user or app-wide toggle | All core screens, errors, print slips and reports have bilingual labels | Must | All | Switching language changes labels without changing saved data. |
| FR-003 | Dashboard | Role-specific dashboard | Open Lots, bundles by stage, karigar balances, shortages, rejects, ready stock, cost summary | Owner sees all; other roles see permitted operational data | Must | Owner/Manager | Dashboard totals reconcile to transaction records. |
| FR-004 | Fabric Inward | Record incoming fabric | Inward ID, date, Fabric Type, Meter, Invoice Number, Supplier/Party, optional rate/amount, remarks | Meter > 0; invoice and supplier searchable; duplicate invoice warning configurable | Must | Store Manager | Saved inward appears in fabric ledger and report. |
| FR-005 | Fabric Stock | Maintain fabric balance | Fabric type, inward meter, issued meter, returned meter, adjustment, balance meter | Every issue/return/adjustment references Lot or reason; adjustments audited | Must | Store Manager/Manager | Balance equals opening + inward - issues + returns +/- adjustments. |
| FR-006 | Lot Management | Create and manage production Lots | Lot No, Lot name, style/design, planned qty, fabric type, start date, due date, status, notes | Lot number unique; status Draft/Active/Hold/Completed/Closed | Must | Manager | A Lot can be searched and all linked bundles/costs are visible. |
| FR-007 | Bundle Management | Create bundle and print slip | Bundle No, Lot No/name, Net Pieces, created date, current stage/location, optional QR/barcode | Unique bundle ID; slip always shows Bundle No, Net Pieces, Lot Name/Number | Must | Supervisor | Print/preview a separate slip for each bundle with confirmed fields. |
| FR-008 | Bundle Split | Split a bundle | Parent Bundle, child Bundle IDs, pieces moved, reason, user/time | Child total must equal parent quantity unless an audited adjustment is recorded | Must | Manager/Supervisor | Split preserves history and totals reconcile. |
| FR-009 | Bundle Merge / Lot Join | Join bundles or link Lots | Source bundles/Lots, target bundle/Lot, quantities, reason, cost allocation method | Never delete source history; require permission and audit trail | Should | Manager | Source and target records retain traceability and allocated costs. |
| FR-010 | Process Tracking | Move bundle through production stages | Lot, Bundle, from stage, to stage, quantity, date/time, location/karigar, sent by, received by | No negative quantity; track partial movement; current location recalculated from latest valid transaction | Must | Supervisor/Manager | A bundle's current stage and responsible party are visible. |
| FR-011 | Karigar Master | Maintain worker/outside unit list | Karigar/unit ID, name, type (in-house/outside), mobile, address, active status, default processes, wage rate | Allow one worker to work on many Lots/bundles and stages | Must | Manager | Worker ledger shows all active and historical jobs. |
| FR-012 | Karigar Issue | Issue pieces for work | Issue ID, date, Lot, Bundle, process, karigar/unit, pieces issued, rate/basis, due date, advance reference | Quantity cannot exceed available pieces unless approved exception; capture issuer | Must | Supervisor | Issued quantity appears in karigar work-in-hand report. |
| FR-013 | Karigar Return | Receive returned pieces | Return ID, issue ID, received qty, good qty, rejected qty, rework qty, short qty, remarks | Good + rejected + rework + short should reconcile to returned/issued quantities per configured definitions; show discrepancy alerts | Must | Supervisor | System flags mismatch and keeps quantity categories distinct. |
| FR-014 | Wage Calculation | Support both wage calculation bases | Rate, basis (issued qty or accepted/returned good qty), process, worker, effective date | Basis configurable per karigar/process/transaction; do not silently change historical rate | Must | Manager/Owner | Same job can use selected wage basis and reproduce correct wage calculation. |
| FR-015 | Advance & Payment | Track advances and settlements | Payment ID, date, karigar, amount, mode, advance/settlement, deduction, reference, remarks | Outstanding cannot be negative without authorized credit/overpayment entry; payment changes audited | Must | Owner/Manager | Ledger shows gross wages, advances, deductions, payments and balance. |
| FR-016 | Reject & Rework | Record defect and rework movement | Lot, Bundle, process, qty, reason/defect, responsible party, rework sent/returned, extra cost | Rework must not be counted as additional good production until accepted | Must | Supervisor/Manager | Rework quantity is visible until resolved and doesn't inflate output. |
| FR-017 | Lot Costing | Record direct and other costs | Cost ID, Lot, cost category, date, qty/unit, rate, amount, supplier/worker, invoice, notes | Categories listed in Costing sheet; prevent duplicate category inclusion in combined rates | Must | Owner/Manager | Lot total equals sum of valid cost entries and adjustments. |
| FR-018 | Cost Allocation | Allocate costs to split/joined Lots | Source Lot, target Lot, amount/percentage/qty basis, approval, reason | Allocation totals must equal original cost; preserve source audit trail | Should | Owner/Manager | No cost is duplicated or lost after split/join. |
| FR-019 | Ready Stock & Packing | Mark finished pieces ready and packed | Lot, Bundle, good qty, pack date, pack reference, carton/packet ref optional | Ready stock only increases after finishing/quality acceptance; pack movement reduces ready-unpacked stock | Must | Supervisor/Manager | Ready, packed and dispatched quantities reconcile. |
| FR-020 | Dispatch | Record dispatch | Dispatch ID, date, party, Lot, bundle/packet, qty, transport, LR/parcel ref, remarks | Dispatch cannot exceed available packed/ready quantity; permissions configurable | Should | Manager/Owner | Dispatch report matches lot and stock ledger. |
| FR-021 | Reports & Export | Filter and export operational reports | Date range, Lot, process, karigar, supplier, status | Export to Excel/PDF; filters should work on mobile and desktop | Must | Role based | Exported totals match on-screen report. |
| FR-022 | Audit Log | Keep trace of changes | User, timestamp, record, action, old/new values, reason | No hard deletion of posted stock/payment transactions; corrections via reversal/adjustment | Must | Owner | Owner can inspect change history for key records. |
| FR-023 | Backup & Security | Protect business data | Scheduled backups, restore plan, secure access, session control | Developer documents backup frequency, retention, and restore test | Must | Owner/Developer | A test restore can recover data; role access is tested. |
| FR-024 | Search & Alerts | Fast search and exception alerts | Lot, Bundle, Invoice, Supplier, Karigar, due date | Flag overdue Lots, long-held bundles, shortages, unreconciled qty, low fabric stock | Should | Manager/Supervisor | Exceptions list matches underlying records. |
## Sheet: Screens & Fields
| Screens & Fields |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Suggested screen inventory. Developer may adjust UI layout while preserving business rules. |  |  |  |  |  |
| Screen ID | Screen Name (EN / HI) | Fields / controls | Actions | Who can use | Required validations / notes |
| SC-01 | Login / लॉगिन | Username/mobile/email, password, language toggle | Login, reset password, logout | All users | Secure authentication; no shared generic user accounts recommended. |
| SC-02 | Dashboard / डैशबोर्ड | Open Lots, stage-wise bundles, overdue work, fabric balance, good/reject/rework/short, wage balances, ready stock | Open record, filter date, export | Role based | Owner dashboard includes financial values; limit sensitive values for other roles. |
| SC-03 | Fabric Inward / कपड़ा आवक | Fabric Type, Meter, Invoice Number, Party/Supplier Name; recommended: date, inward ID, rate, amount, remarks | Save, edit draft, post, print inward slip | Store Manager, Manager; Owner view | Required confirmed fields are the first four. Posted transactions corrected through adjustment. |
| SC-04 | Fabric Ledger / कपड़ा स्टॉक | Fabric type, opening, inward, issued to Lot, returned, adjustment, balance meter | Issue to Lot, return, adjustment, export | Store Manager, Manager, Owner | Every movement references a Lot or a reason. |
| SC-05 | Lot Create / Lot बनाएं | Lot No, Lot Name, style/design, planned pcs, fabric type, start date, due date, status | Create, edit draft, hold/resume, close | Manager, Owner | Unique Lot No; required status; retain history after closure. |
| SC-06 | Bundle Create & Slip / बंडल और स्लिप | Bundle No, Lot Name/No, Net Pieces, date; current stage/location; optional QR/barcode | Create bundle, print/preview slip, split | Supervisor, Manager | Slip must show separate Bundle No, Net Pieces and Lot Name/Number. Do not require size-wise split. |
| SC-07 | Process Movement / प्रोसेस मूवमेंट | Lot, Bundle, from/to process, qty moved, location/karigar/outside unit, send/receive timestamps, sender/receiver | Send, receive, partial receive, report mismatch | Supervisor, Manager | A bundle may be partly moved; unreceived balance stays in transit or at sender as defined. |
| SC-08 | Karigar Master / कारीगर मास्टर | Name, ID, in-house/outside, contact, process capability, wage basis, default rate, active | Add/edit/deactivate, open ledger | Manager, Owner | Do not delete workers with transactions; deactivate instead. |
| SC-09 | Karigar Issue / कारीगर को माल देना | Issue No, Lot, Bundle, process, karigar/unit, issued pcs, rate, basis, issue date, expected return date, advance (optional reference) | Issue, print slip, view outstanding | Supervisor, Manager | Track simultaneous work across multiple Lots and stages. |
| SC-10 | Karigar Return / कारीगर से माल लेना | Issue No, received pcs, good pcs, rejected pcs, rework pcs, short pcs, defect/reason, notes | Receive, flag mismatch, send rework | Supervisor, Manager | System must define whether received qty includes good+reject+rework and how short is calculated; see Decisions sheet. |
| SC-11 | Wages & Advances / मजदूरी और एडवांस | Karigar, period, issue/accepted basis, rate, calculated gross wage, advances, deductions, payments, balance | Calculate, approve, pay, print ledger | Owner, Manager (approval scope configurable) | Use transaction-date rate; log overrides; payment and wage edits audited. |
| SC-12 | Lot Costs / Lot खर्च | Lot, cost category, date, quantity, unit, rate, amount, party/karigar, invoice/ref, note | Add cost, attach invoice ref, approve, export | Manager, Owner | Use cost categories listed in Costing sheet; avoid double-counting included rates. |
| SC-13 | Quality & Rework / क्वालिटी और रीवर्क | Lot, Bundle, process, reject qty, rework qty, defect type, responsible party, rework status, extra cost | Record defect, assign rework, close rework | Supervisor, Manager | Rejected/rework pieces are not good finished output until accepted. |
| SC-14 | Ready Stock & Packing / तैयार माल और पैकिंग | Lot, Bundle, accepted good pcs, ready date, packed qty, packet/carton ref | Mark ready, pack, un-pack correction | Supervisor, Manager | Keep ready-unpacked and packed quantities separate. |
| SC-15 | Dispatch / डिस्पैच | Dispatch ID/date, party, Lot, Bundle/packet, qty, transport, LR/parcel ref | Create dispatch, print dispatch note | Manager, Owner | Cannot dispatch more than available packed/ready quantity. |
| SC-16 | Reports / रिपोर्ट | Filters: date, Lot, process, karigar, supplier, stage, status | View, export Excel/PDF, print | Role based | Totals must reconcile to transaction ledger. |
| SC-17 | Users & Permissions / यूज़र अधिकार | User, role, permitted screens/actions, active status, language | Create user, reset access, deactivate | Owner only | Enforce permissions server-side. |
| SC-18 | Audit Log / बदलाव का रिकॉर्ड | User, timestamp, action, record ID, old value, new value, reason | Search, filter, export | Owner; Manager limited | Critical stock/cost/payment records must be auditable. |
## Sheet: Costing
| Lot Costing Categories |  |  |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- | --- | --- |
| All categories requested by the factory owner. Keep each cost as a separate entry unless included in another rate. |  |  |  |  |  |  |  |
| Cost Code | Cost Category (EN) | Hindi Label | How to enter | Recommended unit | Cost owner / source | Double-counting control | Included in initial scope? |
| C-01 | Fabric | कपड़ा | Enter fabric value consumed by this Lot; use issue meter × rate or allocated invoice value. | Meter / ₹ | Supplier / fabric ledger | Do not charge full inward invoice to every Lot; allocate consumed quantity only. | Yes |
| C-02 | Cutting | कटिंग | Enter cutting labour/charge attributable to Lot. | ₹ / pcs / lot | Cutting worker/unit | If included in a bundled production rate, exclude duplicate entry. | Yes |
| C-03 | Thread / Tread (confirm spelling) | धागा | Enter thread consumption or allocated cost. | ₹ / lot or units | Store / supplier | Confirm whether 'TREAD' means thread; UI label can be changed after confirmation. | Yes |
| C-04 | Pasting | पेस्टिंग | Enter pasting charge/consumption. | ₹ / pcs / lot | Worker/unit | Do not duplicate if included in collar/cuff or stitching rate. | Yes |
| C-05 | Collar & Cuff | कॉलर और कफ | Enter collar/cuff operation or material cost. | ₹ / pcs / lot | Worker/unit/supplier | Specify whether material, labour or combined rate. | Yes |
| C-06 | Side Feed Up (confirm exact operation name) | साइड फीड अप | Enter this operation cost. | ₹ / pcs / lot | Worker/unit | Confirm exact spelling/process with owner before development. | Yes |
| C-07 | Stitching | सिलाई | Enter stitching labour cost using agreed wage basis. | ₹ / accepted pcs or issued pcs | Karigar | If separate process rates are used, don't also include same work in general stitching rate. | Yes |
| C-08 | Button / Kaj | बटन / काज | Enter button and buttonhole charge/material as agreed. | ₹ / pcs / lot | Worker/unit/supplier | Allow labour and material subcategories if useful. | Yes |
| C-09 | Printing / Embroidery | प्रिंटिंग / कढ़ाई | Enter outside vendor bill or in-house cost allocated to Lot. | ₹ / pcs / lot | Outside unit/supplier | Attach invoice/ref and track pieces sent/received separately if applicable. | Yes |
| C-10 | Finishing / Press | फिनिशिंग / प्रेस | Enter finishing and pressing charges. | ₹ / pcs / lot | Worker/unit | Don't duplicate a combined finishing rate. | Yes |
| C-11 | Packing | पैकिंग | Enter packet/carton/polybag/packing labour costs. | ₹ / pcs / lot | Store/packing unit | Separate material and labour if rates differ. | Yes |
| C-12 | Transport / Other Expenses | ट्रांसपोर्ट / अन्य खर्च | Enter transport and other Lot-attributable expense with description. | ₹ / expense | Transporter/other | Require note/category; allocate shared expense across Lots instead of duplicating. | Yes |
## Sheet: Roles & Permissions
| Role & Permission Matrix |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Recommended least-privilege defaults; confirm final approval limits with owner. |  |  |  |  |  |
| Module / Action | Owner | Manager | Supervisor | Store Manager | Notes |
| View overall dashboard | Full | Operational + costing summary | Assigned operational view | Fabric/stock view | Sensitive financial data restricted by role. |
| Manage users and roles | Create/edit/deactivate | No | No | No | Owner-only. |
| Fabric inward entry | View/edit/approve | View/edit/approve | No | Create/edit drafts; post as allowed | Posted records corrected by adjustment. |
| Fabric stock issue/return | Full | Approve/view | Record movement if assigned | Record issue/return | Each movement needs Lot/reason. |
| Create/edit Lot | Full | Create/edit/hold/close | View; no close by default | View assigned fields | Closing a Lot should require reconciliation. |
| Create bundle / print slip | Full | Full | Create/print | View if needed | Separate unique Bundle No. |
| Process movement / location | Full | Full/approve | Record/send/receive | Only material-related movement | Partial quantities supported. |
| Karigar master | Full | Create/edit/deactivate | View/select | No or view-only | Avoid deleting history. |
| Karigar issue/return | Full | Full/approve | Create/receive | No | Every issue tied to Lot+Bundle+process. |
| Wage rate setup / override | Full | Propose; approve per policy | No | No | Historical rates must remain preserved. |
| Wages, advances, payments | Full | View/calculate; payment approval configurable | No | No | Owner approval recommended for payment. |
| Lot costing | Full | Enter/view; approve configurable | No or view limited | No | Owner controls cost corrections. |
| Reject/rework/short entry | Full | Full/approve | Record | No | Reason required for exceptions. |
| Ready stock/packing | Full | Full | Record | Support packing materials if assigned | Must reconcile with accepted good pcs. |
| Dispatch | Full | Create/approve | No by default | No | Dispatch quantity must be validated. |
| Reports/export | All reports | Operational reports + approved cost reports | Assigned production reports | Fabric/stock reports | Exports follow same permissions as on-screen data. |
| Audit log | Full | Limited view | No | No | Never allow normal users to erase audit history. |
## Sheet: Workflows
| Core Workflows |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Primary movement from fabric inward to dispatch; adapt sequence to actual factory routing. |  |  |  |  |  |
| Step | Workflow | From → To | Trigger / entry | System action | Control / exception |
| 1 | Fabric inward | Supplier → Store | Enter Fabric Type, Meter, Invoice Number, Supplier Name; recommended date/rate | Create inward record and increase fabric stock | Warn on duplicate invoice; no stock change until posted. |
| 2 | Create Lot | Planning → Active Lot | Manager creates Lot No/name, design, planned quantity, due date | Create Lot and attach fabric type | Lot number unique; record plan vs actual. |
| 3 | Issue fabric to Lot | Store → Lot/Cutting | Enter meter issued and Lot | Reduce available fabric stock; record consumption against Lot | Return unused fabric and record wastage separately if required. |
| 4 | Create bundle | Cutting → Bundle | Create bundle ID, Lot No/name, Net Pieces | Generate printable slip; bundle appears in current stage | Bundle ID unique; bundle piece total reconciles to cutting output. |
| 5 | Send to process/karigar | Factory → Karigar/Outside unit | Choose bundle, process, quantity, named location, due date, wage basis/rate | Create issue transaction and work-in-hand balance | Support multiple active Lots/bundles per worker. |
| 6 | Receive work | Karigar → Factory/next stage | Enter received, good, reject, rework, short quantities | Update current quantities, location and worker outstanding | Mismatch alerts; do not silently classify missing pieces. |
| 7 | Rework loop | Quality → Rework → Quality | Record defect, qty, responsible party, next action | Create rework movement; close only after accepted or scrapped | Prevent double-counting rework as new output. |
| 8 | Record costs | Supplier/worker/expense → Lot | Enter category, amount, date, reference and allocation | Add cost to Lot ledger | Prevent duplicate cost inclusion; shared costs require allocation. |
| 9 | Finishing & quality acceptance | Finishing → Ready Stock | Record accepted good pcs | Increase ready-good stock | Rejected/rework quantities remain separate until resolved. |
| 10 | Packing | Ready Stock → Packed Stock | Record packed quantity and packet/carton reference | Move quantity from ready-unpacked to packed | Packed quantity cannot exceed available ready quantity. |
| 11 | Dispatch | Packed Stock → Dispatched | Party, date, quantity, transport/ref | Reduce available stock; create dispatch record | Cannot dispatch more than available packed/ready quantity. |
| 12 | Close Lot | Active → Closed | Manager/Owner reviews all process balances, cost and final output | Lock routine edits; allow approved adjustment with audit | No unexplained short/open work/rework without recorded disposition. |
## Sheet: Reports
| Reports & Dashboard |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Minimum reports required at launch. |  |  |  |  |  |
| Report ID | Report Name (EN / HI) | Key columns / metrics | Filters | Who sees it | Reconciliation / notes |
| RP-01 | Fabric Inward Register / कपड़ा आवक रजिस्टर | Date, Fabric Type, Meter, Invoice No, Supplier, amount if captured | Date, supplier, fabric type | Owner, Manager, Store Manager | Must match fabric ledger inward totals. |
| RP-02 | Fabric Stock Ledger / कपड़ा स्टॉक | Opening, inward, issued, returned, adjustments, balance meter | Fabric type, date | Owner, Manager, Store Manager | Opening + inward - issue + return +/- adjustment. |
| RP-03 | Lot Status / Lot स्थिति | Lot No, design, planned qty, actual good qty, stage, due date, ageing | Lot, status, due date | All role-appropriate | Open quantities must match bundle/process ledger. |
| RP-04 | Bundle Location / बंडल लोकेशन | Bundle No, Lot, Net pcs, current process, current karigar/unit, last movement, ageing | Lot, stage, location, age | Owner, Manager, Supervisor | One current location per piece quantity; partial moves supported. |
| RP-05 | Karigar Work-in-Hand / कारीगर के पास माल | Worker/unit, Lot, Bundle, process, issued, returned, outstanding qty, due date | Worker, Lot, process, overdue | Owner, Manager, Supervisor limited | Issued quantity reconciles to accepted/returned, rework and open balance. |
| RP-06 | Karigar Wage Ledger / मजदूरी लेजर | Gross wage, wage basis, rate, advances, deductions, payments, balance | Worker, period, process | Owner; Manager as permitted | Must match approved wage transactions. |
| RP-07 | Short / Reject / Rework / कमी-रिजेक्ट-रीवर्क | Lot, Bundle, worker, process, qty, reason, status, cost | Date, Lot, worker, reason | Owner, Manager, Supervisor | Separate totals; rework not double-counted as output. |
| RP-08 | Lot Cost Sheet / Lot लागत | Category-wise amount, total cost, good finished qty, cost per good piece | Lot, date, cost category | Owner; Manager per permission | Cost per good piece = allocated actual cost ÷ good finished qty. |
| RP-09 | Production by Process / प्रोसेस उत्पादन | Sent qty, received qty, accepted qty, pending qty, cycle time | Date, process, worker, Lot | Owner, Manager, Supervisor | Clarify metric definitions before build. |
| RP-10 | Ready / Packed / Dispatch Stock | Ready-unpacked, packed, dispatched, remaining stock | Lot, party, date | Owner, Manager, Supervisor limited | Opening + accepted ready - packed/dispatch as relevant. |
| RP-11 | Overdue / Ageing Alerts | Lots past due, bundles at a location longer than threshold, overdue returns | Age threshold, date, stage | Owner, Manager, Supervisor | Threshold configurable. |
| RP-12 | Audit Log / बदलाव रिपोर्ट | User, date/time, record, action, old/new values, reason | User, record type, date | Owner | For sensitive data and dispute resolution. |
## Sheet: Decisions to Confirm
| Open Decisions / Before Development |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Known choices are separated from assumptions so the developer does not hard-code an unconfirmed business rule. |  |  |  |  |  |
| Decision ID | Topic | Confirmed so far | Suggested default for developer | Owner decision needed | Status |
| D-01 | Bundle quantity | Each bundle has separate slip; Net Pieces and Lot Name/Number shown. User asked not to get into size-wise tracking. | Bundle-level quantities; optional notes for size mix, but no mandatory size breakdown. | Confirm usual pieces per bundle only if needed for labels; system should allow variable quantity. | Open |
| D-02 | Wage basis | Both issue-based and returned-piece-based methods are used. | Select basis per process/karigar/issue; accepted-good-piece basis is distinct from issued quantity. | For returned-piece basis, is wage paid on all returned pieces or only accepted good pieces? | Open |
| D-03 | Rejected/short wage impact | Short, Reject and Rework tracked separately. | No automatic wage deduction by default; calculate and flag for authorized review. | Should rejected/short pieces reduce wages automatically, or only after manager approval? | Open |
| D-04 | Advance recovery | Advance recovery is required; exact policy not yet supplied. | Record advance and deduct in settlement according to approved amount; never silently auto-deduct. | Fixed deduction per settlement, full balance, or manually chosen amount? | Open |
| D-05 | Lot costing rate inclusion | All 12 cost categories confirmed. | Separate categories and flag included-in-other-rate to prevent duplication. | Are Collar & Cuff, Pasting and Side Feed Up separate labour charges, materials, or both? | Open |
| D-06 | Thread/Tread spelling | User typed TREAD; likely may mean Thread, but not assumed as fact. | Display 'Thread / Tread (confirm spelling)' until owner confirms. | Should field label be THREAD (धागा) or TREAD? | Open |
| D-07 | Side Feed Up process name | User typed SIDE FEED UP. | Use exact owner term initially; developer can make label configurable. | Confirm exact operation name/spelling used in factory. | Open |
| D-08 | Location model | Track process plus named karigar/outside unit/location. | Each movement has process + location/worker + quantity + timestamp. | Do you also need floor/table as separate location master, or is worker/outside unit enough? | Open |
| D-09 | Lot split/join costing | Need to support splitting or joining Lots. | Preserve source Lot history; allocate cost by quantity or approved manual percentage; audit all changes. | Preferred cost allocation basis for split/join? | Open |
| D-10 | Fabric valuation | Fabric inward fields confirmed: Fabric Type, Meter, Invoice Number, Supplier Name. | Add inward date, rate and amount to calculate Lot cost; allocate cost by actual meters consumed. | Will you enter fabric rate per meter on each invoice? | Open |
| D-11 | Internet/offline | Internet available. | Online-first responsive web app/PWA; offline support not required in phase 1. | No action unless offline use becomes necessary. | Confirmed |
| D-12 | Old data migration | New system; no old register/Excel migration. | Start with blank masters and opening balances if needed. | Do you need opening fabric/ready stock entered on launch day? | Open |
| D-13 | Approval hierarchy | Owner, Manager, Supervisor, Store Manager. | Owner has full access; role-specific server-side access; wage/payment/cost overrides owner-approved. | Confirm manager limits for cost approvals and payments. | Open |
| D-14 | Dispatch scope | Previous discussion suggests Lot-wise and packet/bundle-wise; avoid size complexity. | Track Lot, packet/bundle ref, quantity, party, transport/LR/parcel reference. | Confirm whether dispatch module is required in first release or just ready-stock tracking. | Open |
## Sheet: Data Dictionary
| Suggested Database Data Dictionary |  |  |  |  |  |
| --- | --- | --- | --- | --- | --- |
| Developer may rename tables/fields, but keep relationships and validation logic. |  |  |  |  |  |
| Entity / Table | Field | Type | Required? | Example / allowed values | Purpose / rule |
| User | user_id | Unique ID | Yes | USR-0001 | Primary key. |
| User | role | Enum | Yes | Owner / Manager / Supervisor / Store Manager | Permission role. |
| FabricInward | inward_id | Unique ID | Yes | FIN-0001 | Primary key. |
| FabricInward | fabric_type | Text / master ref | Yes | Oxford / Denim / etc. | Owner-defined fabric categories. |
| FabricInward | meter | Decimal | Yes | 250.50 | Must be greater than zero. |
| FabricInward | invoice_number | Text | Yes | INV-1024 | Store invoice reference. |
| FabricInward | supplier_id | Master ref | Yes | SUP-0001 | Party/supplier name. |
| Lot | lot_id | Unique ID | Yes | LOT-0001 | Internal stable key. |
| Lot | lot_number | Text | Yes | L-101 | Unique human-readable Lot number. |
| Lot | status | Enum | Yes | Draft / Active / Hold / Completed / Closed | Workflow state. |
| Bundle | bundle_id | Unique ID | Yes | BND-0001 | Internal stable key. |
| Bundle | bundle_number | Text | Yes | B-001 | Unique bundle/slip number. |
| Bundle | lot_id | Foreign key | Yes | LOT-0001 | Bundle belongs to a Lot; split/join uses lineage table. |
| Bundle | net_pieces | Integer | Yes | 5 / 10 / 20 | Net piece count on slip; must be non-negative. |
| ProcessMovement | process_code | Enum/master ref | Yes | Cutting / Stitching / Button-Kaj / Finishing | Current process and route. |
| ProcessMovement | location_or_karigar_id | Master ref | Yes | KAR-0001 / UNIT-0001 | Named responsible person/unit/location. |
| KarigarIssue | issued_pcs | Integer | Yes | 100 | Quantity assigned to worker/process. |
| KarigarReturn | good_pcs | Integer | Yes | 95 | Accepted good pieces. |
| KarigarReturn | rejected_pcs | Integer | Yes | 2 | Rejected pieces. |
| KarigarReturn | rework_pcs | Integer | Yes | 1 | Pieces requiring rework. |
| KarigarReturn | short_pcs | Integer | Calculated/confirmed | 2 | Unaccounted pieces under agreed reconciliation definition. |
| WageTransaction | wage_basis | Enum | Yes | Issued pcs / Accepted good pcs / Returned pcs | Basis selected per policy; exact meaning confirmed before build. |
| WageTransaction | rate | Currency per unit | Yes | ₹/piece | Effective-dated rate; historical transactions preserve rate. |
| WageTransaction | advance_balance | Currency | Calculated | ₹ amount | Advance ledger balance. |
| LotCost | cost_category | Enum/master ref | Yes | Fabric / Stitching / Packing etc. | Use Costing sheet codes. |
| LotCost | amount | Currency | Yes | ₹ amount | Amount allocated to Lot. |
| LotCost | allocation_basis | Enum | When shared | Meter / Qty / Percentage / Manual | Must reconcile to original shared cost. |
| AuditLog | old_value_new_value | JSON/text | For edits | Old/new values | Immutable audit history for critical records. |
## Sheet: Sample Calculations
| Calculation Rules & Examples |  |  |  |  |
| --- | --- | --- | --- | --- |
| Examples are illustrative; wage deduction policy and quantity reconciliation still require owner confirmation. |  |  |  |  |
| Calculation | Formula / logic | Example input | Expected result | Developer note |
| Fabric balance | Opening meter + inward meter - issued meter + returned meter +/- adjustments | Opening 0; inward 500; issued 320; return 15 | 195 meter balance | Wastage should be a separate movement if tracked. |
| Bundle reconciliation | Issued pcs = good pcs + rejected pcs + rework pcs + short pcs + open/unreturned pcs (depending on defined stage) | Issued 100; good 94; rejected 2; rework 1; short 2; open 1 | 100 reconciled | Define whether rework is a subset of returned pcs; avoid counting same piece twice. |
| Wage on issued quantity | Wage = eligible issued pcs × rate | 100 pcs × ₹12 | ₹1,200 gross wage | Only use when wage basis is set to issued quantity. |
| Wage on accepted good quantity | Wage = accepted good pcs × rate | 94 pcs × ₹12 | ₹1,128 gross wage | Use only when accepted-good basis is selected. |
| Karigar settlement balance | Opening payable + approved wages - advances recovered - other approved deductions - payments | ₹5,000 + ₹2,000 - ₹1,000 - ₹3,000 | ₹3,000 remaining payable | Advances given are recorded separately from advances recovered. |
| Lot total cost | Sum of all valid cost entries allocated to the Lot | Fabric ₹25,000 + process costs ₹20,000 + other ₹3,000 | ₹48,000 total cost | Shared cost allocations must sum to original expense. |
| Cost per good finished piece | Lot total allocated cost ÷ accepted good finished pcs | ₹48,000 ÷ 960 good pcs | ₹50 per good piece | If good finished pcs = 0, show blank/not available, not divide by zero. |
| Lot split cost allocation | Source cost × target allocation ratio, with all allocations summing to 100% | ₹10,000 cost split 60% / 40% | ₹6,000 and ₹4,000 | Keep original source record and allocation links. |
## Sheet: Process Master
| Production Process Master |  |  |  |  |
| --- | --- | --- | --- | --- |
| Initial suggested routing based on information supplied; owner/manager can configure actual route order. |  |  |  |  |
| Suggested order | Process Name (EN) | Hindi Label | Track as separate stage? | Notes |
| 1 | Fabric Inward | कपड़ा आवक | Yes | Stock receipt before issue to Lot. |
| 2 | Cutting | कटिंग | Yes | Bundle creation and Net Pieces happen around this stage. |
| 3 | Thread / Tread | धागा | Confirm | Confirm whether this is a cost-only category or process stage. |
| 4 | Pasting | पेस्टिंग | Yes | Confirm whether separate process stage or cost only. |
| 5 | Collar & Cuff | कॉलर और कफ | Yes | Can be a separate operation with worker/unit tracking. |
| 6 | Side Feed Up | साइड फीड अप | Yes | Use owner wording until exact name confirmed. |
| 7 | Stitching | सिलाई | Yes | Can include multiple operations if factory chooses. |
| 8 | Button / Kaj | बटन / काज | Yes | Button and buttonhole operation. |
| 9 | Printing / Embroidery | प्रिंटिंग / कढ़ाई | Yes | Often outside unit; track sent/received quantity. |
| 10 | Finishing / Press | फिनिशिंग / प्रेस | Yes | Final finish and press. |
| 11 | Quality Acceptance | क्वालिटी चेक | Yes | Accept good, reject or route to rework. |
| 12 | Packing | पैकिंग | Yes | Track packed quantity and packet/carton reference. |
| 13 | Ready Stock | तैयार माल | Yes | Ready but not yet dispatched. |
| 14 | Dispatch | डिस्पैच | Yes | Record party, quantity and transport reference. |
## Sheet: Handover Checklist
| Developer Handover & UAT Checklist |  |  |  |  |
| --- | --- | --- | --- | --- |
| Use during design review, development testing, and final acceptance. |  |  |  |  |
| Stage | Checklist item | Acceptance criteria | Status | Notes / sign-off |
| Discovery | Review all open decisions | All D-01 to D-14 decisions reviewed; no critical business rule left assumed | Open |  |
| Design | Approve screens and mobile layout | Supervisor can create/scan/search bundles comfortably on phone; owner dashboard readable on computer and phone | Open |  |
| Security | Test role permissions | Users cannot access prohibited screens/actions by changing URL/API requests | Open |  |
| Fabric | Test inward and ledger | Meter balances reconcile with inward/issue/return/adjustments | Open |  |
| Lot/Bundle | Test Lot and separate bundle slips | Every slip shows Bundle No, Net Pieces, Lot Name/Number; IDs unique | Open |  |
| Process | Test multi-Lot work | One karigar can hold bundles from multiple Lots and processes without mixing records | Open |  |
| Wages | Test both wage bases | Issued-based and selected returned/accepted-based wage calculations are correct; advances and payments reconcile | Open |  |
| Quality | Test short/reject/rework | All quantities remain distinct and no piece is double-counted | Open |  |
| Costing | Test Lot costing | All requested categories included; shared cost allocation reconciles; no duplicate costs | Open |  |
| Reports | Reconcile reports | Dashboard and exports match transaction ledger totals | Open |  |
| Audit | Test corrections | Posted stock, wage and cost corrections are traceable; audit log records old/new values and user/time | Open |  |
| Backup | Restore test | Developer demonstrates successful restore from backup | Open |  |
| UAT | Owner signs off | Owner tests real sample Lot end-to-end before production go-live | Open |  |