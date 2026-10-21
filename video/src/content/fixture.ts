/**
 * The film's one dataset. Every name, number and date here is FICTIONAL demonstration data:
 * Aldervane Fluid Systems, Halden Water Board, Corran Valves and every person named are invented,
 * and none of them is a real client. Values are chosen once; anything that can be derived
 * (scaled BOM quantities, cost, margin, totals) is computed below so no two scenes can disagree.
 *
 * Field shapes follow the product's own records (see docs/coverage-matrix.md for each source file):
 * money is integer paise, quantities are per unit on a BOM and scaled onto the order, checks carry
 * a unit and limits, and a revision is "R01", "R02".
 */

/* -------------------------------- formatting -------------------------------- */

/** Same rules as `src/app/(shell)/jobs/format.ts` `inr()`: Indian grouping, compact as lakh. */
export function inr(minor: number, { compact = false }: { compact?: boolean } = {}): string {
  const rupees = minor / 100;
  if (compact && Math.abs(rupees) >= 100_000) {
    return `₹${(rupees / 100_000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} L`;
  }
  return `₹${rupees.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Same as the product's `dateText()`: "9 Oct 2026". */
export function dateText(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const rupees = (r: number) => r * 100;

/* --------------------------------- the world -------------------------------- */

export const COMPANY = { name: "Aldervane Fluid Systems", short: "Aldervane", works: "Aldervane Works, Bay 2" };

export const PEOPLE = {
  owner: { name: "Vikram Sethi", role: "Managing director" },
  engineer: { name: "Kabir Shah", role: "Design engineer" },
  engLead: { name: "Priya Nair", role: "Engineering lead" },
  buyer: { name: "Meera Iyer", role: "Purchase" },
  supervisor: { name: "Sunil Verma", role: "Production supervisor" },
  inspector: { name: "Arjun Rao", role: "Quality inspector" },
  logistics: { name: "Ravi Das", role: "Dispatch" },
  accounts: { name: "Nisha Pillai", role: "Accounts" },
} as const;

export const CUSTOMER = { name: "Halden Water Board", contact: "R. Kulkarni, Project engineer" };

/* ---------------------------------- the job ---------------------------------- */

export const JOB = {
  ref: "J-0142",
  title: "Booster pump skids, 2 × 75 kW",
  customer: CUSTOMER.name,
  priority: "High",
  opened: "2026-09-22",
  promised: "2026-12-19",
  steps: ["Enquiry", "Quoted", "Approved", "In production", "Completed"],
};

export type QuoteLine = { what: string; qty: number; unit: number };
const quoteTotal = (lines: QuoteLine[]) => lines.reduce((s, l) => s + l.qty * l.unit, 0);

const R1_LINES: QuoteLine[] = [
  { what: "Booster pump skid, 2 × 75 kW duty and standby, fabricated base", qty: 2, unit: rupees(11_20_000) },
  { what: "Hydrostatic test and test certificate", qty: 1, unit: rupees(60_000) },
  { what: "Packing and delivery to site", qty: 1, unit: rupees(60_000) },
];
const R2_LINES: QuoteLine[] = [
  { what: "Booster pump skid, 2 × 75 kW duty and standby, fabricated base", qty: 2, unit: rupees(10_40_000) },
  { what: "Hydrostatic test and test certificate", qty: 1, unit: rupees(60_000) },
  { what: "Packing and delivery to site", qty: 1, unit: rupees(1_00_000) },
];

export const QUOTES = [
  { rev: 1, lines: R1_LINES, total: quoteTotal(R1_LINES), sent: "2026-09-26", state: "Replaced" },
  { rev: 2, lines: R2_LINES, total: quoteTotal(R2_LINES), sent: "2026-10-01", state: "Approved", approved: "2026-10-06" },
] as const;

/** Snapshotted onto the job at approval (`approveQuote`, project/jobs.ts). */
export const AGREED = QUOTES[1].total;

export const TASKS = [
  { name: "Release GA drawing", team: "Engineering", waitsFor: null, state: "Done" },
  { name: "Hold stock for the production order", team: "Stores", waitsFor: "Release GA drawing", state: "Done" },
  { name: "Fabricate base frames", team: "Fabrication", waitsFor: "Release GA drawing", state: "Done" },
  { name: "Factory acceptance test with customer", team: "Quality", waitsFor: "Fabricate base frames", state: "Ready" },
  { name: "Pack and dispatch", team: "Logistics", waitsFor: "Factory acceptance test with customer", state: "Waiting" },
] as const;

export const MILESTONES = [
  { name: "GA drawing approved by customer", due: "2026-10-10", reached: true },
  { name: "Factory acceptance test", due: "2026-12-12", reached: false },
  { name: "Dispatch", due: "2026-12-18", reached: false },
  { name: "Delivery promised", due: "2026-12-19", reached: false },
] as const;

/* ------------------------------ engineering + BOM ------------------------------ */

export const DRAWING = {
  number: "AFS-GA-0457",
  title: "General arrangement, booster pump skid BPS-75",
  type: "General arrangement drawing",
  revisions: [
    { label: "R01", state: "superseded", releasedBy: PEOPLE.engLead.name, released: "2026-09-29", why: "First issue" },
    {
      label: "R02",
      state: "released",
      writtenBy: PEOPLE.engineer.name,
      releasedBy: PEOPLE.engLead.name,
      released: "2026-10-09",
      why: "Discharge header raised 150 mm to meet the site pipe rack",
    },
  ],
  opens: 14,
};

export type BomLine = { item: string; perUnit: number; uom: string; unitCost: number };

export const BOM = {
  code: "BPS-75-A",
  produces: "Booster pump skid BPS-75",
  lines: [
    { item: "ISMC 150 channel, base frame", perUnit: 18, uom: "m", unitCost: rupees(1_150) },
    { item: "Centrifugal pump 150 × 125", perUnit: 2, uom: "nos", unitCost: rupees(68_000) },
    { item: "Motor 75 kW, 4-pole", perUnit: 2, uom: "nos", unitCost: rupees(1_05_000) },
    { item: "Flexible coupling with guard", perUnit: 2, uom: "nos", unitCost: rupees(9_800) },
    { item: "Header pipe DN200, sch 40", perUnit: 6, uom: "m", unitCost: rupees(4_200) },
    { item: "Butterfly valve DN200", perUnit: 2, uom: "nos", unitCost: rupees(38_500) },
    { item: "Non-return valve DN150", perUnit: 2, uom: "nos", unitCost: rupees(21_600) },
    { item: "Control panel, star-delta", perUnit: 1, uom: "nos", unitCost: rupees(74_000) },
    { item: "Pressure gauge 0–25 bar", perUnit: 2, uom: "nos", unitCost: rupees(2_400) },
    { item: "Gasket and fastener kit", perUnit: 1, uom: "set", unitCost: rupees(6_500) },
  ] as BomLine[],
};

export const ORDER = {
  ref: "BPS-75 ×2 | Halden",
  qty: 2,
  location: COMPANY.works,
  /** Lines scaled by the order quantity and copied on (`createOrderFromBom`, manufacturing/bom.ts). */
  lines: BOM.lines.map((l) => ({ ...l, qty: l.perUnit * 2 })),
};

/* ------------------------------ procurement + stock ------------------------------ */

export const SHORT = { item: "Butterfly valve DN200", need: 4, available: 1 };
/** Wording of `reserveOrder`'s refusal (manufacturing/batch.ts line 97). */
export const SHORT_MESSAGE = `not enough ${SHORT.item} to reserve (need ${SHORT.need}, ${SHORT.available} available)`;

export const PO = {
  ref: "PO-0318",
  vendor: "Corran Valves",
  item: SHORT.item,
  qty: 3,
  unit: rupees(38_500),
  get total() {
    return this.qty * this.unit;
  },
  /** `DEFAULT_PO_APPROVAL_THRESHOLD_PAISE` in inventory/procurement.ts. */
  threshold: 2_500_000,
  approvedBy: PEOPLE.owner.name,
  receipts: [
    { qty: 2, on: "2026-10-27" },
    { qty: 1, on: "2026-11-03" },
  ],
};

/* ------------------------------- production + QC ------------------------------- */

export type Check = { label: string; unit?: string; min?: number; max?: number; reading?: number; photo?: boolean };
export type Stage = { key: string; label: string; checks: Check[] };

export const ROUTE: Stage[] = [
  {
    key: "fab",
    label: "Frame fabrication",
    checks: [{ label: "Weld visual inspection", photo: true }, { label: "Frame diagonal difference", unit: "mm", max: 3, reading: 1.5 }],
  },
  { key: "mach", label: "Machining", checks: [{ label: "Pump pedestal flatness", unit: "mm", max: 0.1, reading: 0.04 }] },
  { key: "asm", label: "Assembly and alignment", checks: [{ label: "Coupling alignment offset", unit: "mm", max: 0.05, reading: 0.03 }] },
  {
    key: "hydro",
    label: "Pressure test",
    checks: [
      { label: "Hydrostatic test pressure", unit: "bar", min: 15.0, max: 15.5, reading: 15.2 },
      { label: "Hold 30 min, no visible leak", photo: true },
    ],
  },
  {
    key: "run",
    label: "Run test",
    checks: [
      { label: "Vibration at rated duty", unit: "mm/s", max: 4.5, reading: 2.1 },
      { label: "Motor insulation resistance", unit: "MΩ", min: 100, reading: 520 },
    ],
  },
  { key: "pack", label: "Packing and dispatch preparation", checks: [] },
];

export const CHECK_COUNT = ROUTE.reduce((n, s) => n + s.checks.length, 0);

export const FAILURE = {
  stage: "Pressure test",
  check: "Hold 30 min, no visible leak",
  remarks: "Weep at discharge header flange, joint 3",
  sendBackTo: "Assembly and alignment",
  reason: "Re-make flange joint 3 with a new gasket",
  by: PEOPLE.inspector.name,
  at: "2026-12-03 15:42",
};

export const FLOOR = {
  open: 11,
  ready: 3,
  onHold: 1,
  rework: 1,
  rows: [
    { order: ORDER.ref, product: BOM.produces, stage: "Pressure test", of: "Stage 4 of 6", qty: 2, state: "active" as const, label: "in progress" },
    { order: "DS-3P ×1 | Corvel", product: "Dosing skid, 3-pump", stage: "Pressure test", of: "Stage 4 of 6", qty: 1, state: "blocked" as const, label: "on hold" },
    { order: "FPS-180 ×1 | Brenmoor", product: "Fire pump set, 180 m³/h", stage: "Frame fabrication", of: "Stage 1 of 6", qty: 1, state: "pending" as const, label: "pending" },
    { order: "TPS-22 ×1 | Ostra", product: "Transfer pump skid", stage: "Machining", of: "Stage 2 of 6", qty: 1, state: "pending" as const, label: "pending" },
  ],
};

/* ---------------------------------- dispatch ---------------------------------- */

export const DISPATCH = {
  transporter: "Westline Carriers",
  vehicle: "MH 00 AF 4417",
  tracking: "LR 58213",
  dispatched: "2026-12-18 10:40",
  delivered: "2026-12-19",
  by: PEOPLE.logistics.name,
};

export const PASSPORT = { product: BOM.produces, reference: `${JOB.ref} · unit 1 of 2`, completed: "2026-12-17", issuedBy: COMPANY.name };

/* ------------------------------------ money ------------------------------------ */

const materialMinor = ORDER.lines.reduce((s, l) => s + l.qty * l.unitCost, 0);
const LABOUR = { hours: 312, rate: rupees(650) };
const OTHER = [
  { what: "Galvanising, base frames (subcontract)", amount: rupees(62_000) },
  { what: "Freight to site", amount: rupees(46_000) },
  { what: "Gauge calibration, third party", amount: rupees(8_500) },
];

/**
 * The job's cost, built the way `jobCosting()` (project/reads.ts) builds it: material is consumed
 * quantity at moving-average cost (an estimate), labour is hours x rate, other is recorded entries.
 */
export const COST = {
  quoted: AGREED,
  material: materialMinor,
  labour: LABOUR.hours * LABOUR.rate,
  labourHours: LABOUR.hours,
  other: OTHER.reduce((s, o) => s + o.amount, 0),
  otherLines: OTHER,
  get total() {
    return this.material + this.labour + this.other;
  },
  get margin() {
    return this.quoted - this.total;
  },
  get marginPct() {
    return Math.round((this.margin / this.quoted) * 1000) / 10;
  },
};

export const BILLING = [
  { kind: "Advance", amount: Math.round(AGREED * 0.3), raised: "2026-10-07", received: "2026-10-14" },
  { kind: "Final", amount: AGREED - Math.round(AGREED * 0.3), raised: "2026-12-18", received: null },
];

/* ------------------------------- the operation, 19 Dec ------------------------------- */

export const TODAY = "2026-12-19";

export const JOBS_IN_WORK = [
  { ref: "J-0139", what: "Dosing skid, 3-pump", customer: "Corvel Foods", state: "active" as const, label: "in progress", promised: "2026-12-14", value: rupees(9_80_000), progress: 70 },
  { ref: JOB.ref, what: JOB.title, customer: CUSTOMER.name, state: "active" as const, label: "in progress", promised: JOB.promised, value: AGREED, progress: 80 },
  { ref: "J-0144", what: "Fire pump set, 180 m³/h", customer: "Brenmoor Logistics Park", state: "active" as const, label: "in progress", promised: "2027-01-09", value: rupees(14_60_000), progress: 45 },
  { ref: "J-0146", what: "Transfer pump skid", customer: "Ostra Chemicals", state: "blocked" as const, label: "on hold", promised: "2027-01-22", value: rupees(7_40_000), progress: 20 },
  { ref: "J-0148", what: "Cooling water skid, 2 × 30 kW", customer: "Velan Textiles", state: "pending" as const, label: "approved", promised: "2027-02-05", value: rupees(11_20_000), progress: 0 },
  { ref: "J-0150", what: "Booster pump skid, 1 × 37 kW", customer: CUSTOMER.name, state: "pending" as const, label: "approved", promised: "2027-02-20", value: rupees(8_90_000), progress: 0 },
];

export const SUMMARY = {
  confirmed: JOBS_IN_WORK.reduce((s, j) => s + j.value, 0),
  quotesOut: rupees(31_20_000),
  quotesSent: 3,
  enquiries: 2,
  late: 1,
  attention: [
    { ref: "J-0139", text: 'Milestone "Dispatch" was due 14 Dec 2026', hint: "Mark it reached if it is done, otherwise find out what is holding it.", kind: "late" },
    { ref: "J-0146", text: 'Task "Receive motor from supplier" is blocked', hint: "Find what is blocking it and ask Stores, then resume or reassign it.", kind: "blocked" },
    { ref: "J-0151", text: "Quote revision 1 expired on 15 Dec 2026, no reply", hint: "Follow up with the customer, or send a revised quote.", kind: "quote" },
  ],
  short: [
    { item: "Non-return valve DN150", onHand: 2, reorder: 6, uom: "nos" },
    { item: "Gasket and fastener kit", onHand: 1, reorder: 4, uom: "set" },
  ],
};

export const ASSISTANT = {
  question: "Which jobs are late, and what is holding them?",
  answer: [
    "One job is past its promised date.",
    "J-0139, the dosing skid for Corvel Foods, was promised for 14 Dec 2026. Its Pressure test stage is on hold: “Waiting for calibrated gauge”.",
    "The calibrated gauge is due back on Monday.",
  ],
  unconfirmed: "“due back on Monday”",
};

export const HISTORY = [
  { what: "Released", detail: `${DRAWING.number} R02`, who: PEOPLE.engLead.name, at: "9 Oct 2026, 16:20" },
  { what: "Purchase order approved", detail: `${PO.ref} · ${inr(rupees(1_15_500))}`, who: PEOPLE.owner.name, at: "21 Oct 2026, 11:05" },
  { what: "Check failed", detail: FAILURE.check, who: PEOPLE.inspector.name, at: "3 Dec 2026, 15:42" },
  { what: "Sent back", detail: `to ${FAILURE.sendBackTo}`, who: PEOPLE.supervisor.name, at: "3 Dec 2026, 15:50" },
  { what: "Check passed", detail: "Hydrostatic test pressure, 15.2 bar", who: PEOPLE.inspector.name, at: "5 Dec 2026, 12:10" },
  { what: "Dispatched", detail: `${DISPATCH.transporter} · ${DISPATCH.vehicle}`, who: PEOPLE.logistics.name, at: "18 Dec 2026, 10:40" },
];

/** The questions of Act I, and the record that answers each one in Act IV. */
export const QUESTIONS = [
  { from: "Stores", text: "Is the DN200 valve ordered yet?", answer: `${PO.ref} · Received`, state: "completed" as const },
  { from: "Design office", text: "Which drawing revision is the frame on?", answer: `${DRAWING.number} · R02 released`, state: "completed" as const },
  { from: "Quality", text: "Pressure test today or tomorrow?", answer: "Pressure test · Passed, 15.2 bar", state: "completed" as const },
  { from: CUSTOMER.name, text: "Can you confirm the delivery date?", answer: "Delivered · 19 Dec 2026", state: "completed" as const },
  { from: "Accounts", text: "Has the advance come in?", answer: `Advance · ${inr(Math.round(AGREED * 0.3))} received`, state: "completed" as const },
  { from: "Shop floor", text: "Are both skids packed?", answer: "Packing · Completed 17 Dec", state: "completed" as const },
];

/* ------------------------------ the pipeline (CRM), 19 Dec ------------------------------ */

/**
 * Open deals in the CRM pipeline (`relationship` capability, Task 128). Stage names and chances are
 * the capability's DEFAULT_STAGES; references are `OPP-<n>`. All fictional.
 */
export const PIPELINE_STAGES = [
  { key: "enquiry", label: "Enquiry", chance: 10 },
  { key: "qualified", label: "Qualified", chance: 25 },
  { key: "quote", label: "Technical quote", chance: 50 },
  { key: "negotiation", label: "Negotiation", chance: 75 },
  { key: "won", label: "Won", chance: 100 },
] as const;

export const DEALS = [
  { ref: "OPP-64", name: "Booster set, 3 × 22 kW", company: "Talvane Estates", value: rupees(14_20_000), stage: "enquiry" },
  { ref: "OPP-66", name: "Fire pump retrofit", company: "Orion Cold Chain", value: rupees(9_80_000), stage: "enquiry" },
  { ref: "OPP-59", name: "Transfer skid, 2 × 30 kW", company: "Ostra Chemicals", value: rupees(12_60_000), stage: "qualified" },
  { ref: "OPP-57", name: "Cooling water skid", company: "Velan Textiles", value: rupees(18_40_000), stage: "quote" },
  { ref: "OPP-62", name: "Dosing package", company: "Corvel Foods", value: rupees(6_90_000), stage: "quote" },
  { ref: "OPP-61", name: "Fire pump set, 2 × 90 kW", company: "Marrow Ridge Hospital", value: rupees(28_60_000), stage: "negotiation" },
  { ref: "OPP-55", name: "Booster pump skid, 1 × 37 kW", company: CUSTOMER.name, value: rupees(8_90_000), stage: "won" },
];

/** The deal the scene follows, and the job it opens (the next job number after J-0151). */
export const HERO_DEAL = {
  ref: "OPP-61",
  contact: "R. Menon",
  contactEmail: "r.menon@marrowridge.example",
  source: "Tender",
  closes: "2026-12-24",
  job: "J-0152",
  timeline: [
    { what: "Stage moved", detail: "Technical quote → Negotiation", who: "Meera Iyer", at: "15 Dec 2026" },
    { what: "Call logged", detail: "R. Menon asked for the layout with a jockey pump", who: "Kabir Shah", at: "17 Dec 2026" },
    { what: "Follow-up", detail: "Send the revised layout", who: "Kabir Shah", at: "due 19 Dec 2026" },
  ],
};

const openDeals = DEALS.filter((d) => d.stage !== "won");
const chance = (k: string) => PIPELINE_STAGES.find((s) => s.key === k)?.chance ?? 0;
export const PIPELINE_TILES = {
  open: openDeals.reduce((s, d) => s + d.value, 0),
  weighted: openDeals.reduce((s, d) => s + (d.value * chance(d.stage)) / 100, 0),
  wonThisMonth: DEALS.filter((d) => d.stage === "won").reduce((s, d) => s + d.value, 0),
  overdue: 2,
};
