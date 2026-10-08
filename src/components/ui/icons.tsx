/**
 * The Verity icon set.
 *
 * Authority: the identity board's ICON STYLE row — thin single-weight line
 * geometry on a 24×24 field, 1.4 stroke, round caps and joins. Path data is
 * taken from the design source rather than substituted from an icon library,
 * because a library's optical weight will not match the board's and mixing two
 * families is the fastest way to make an interface look assembled from parts.
 *
 * WHY A CLOSED SET, AND WHY THE PLATFORM OWNS IT
 * A capability picks an icon by NAME; it never ships SVG. That keeps the
 * platform capability-agnostic (it does not know what "Evidence" looks like)
 * while keeping the icon set a design-system concern (a capability cannot
 * introduce a filled cartoon glyph into the rail). Adding an icon is a design
 * system change, which is the correct place to make one.
 *
 * The brand symbol is NOT in this set. It lives in `brand/VerityMark` and is
 * never used as a generic glyph — the board's hourglass is the identity, not a
 * loading spinner.
 */

export type IconName =
  | "overview"
  | "workspace"
  | "locations"
  | "assets"
  | "schedule"
  | "evidence"
  | "approvals"
  | "capabilities"
  | "configuration"
  | "audit"
  | "catalogue"
  | "parties"
  | "purchases"
  | "sales"
  | "stock"
  | "tax"
  | "people"
  | "supplier"
  | "finance"
  | "ledger"
  | "search"
  | "bell"
  | "collapse"
  | "expand"
  | "signOut"
  | "sun"
  | "moon"
  | "system"
  | "chevronDown"
  | "chevronRight"
  | "building"
  | "check"
  | "close"
  | "assistant"
  | "mail"
  | "lock"
  | "eye"
  | "eyeOff"
  | "plus"
  | "eyedropper"
  | "moreHorizontal"
  | "book"
  | "clock"
  | "flag"
  | "manufacturing"
  | "tag"
  | "user"
  | "wallet";

const PATHS: Record<IconName, string> = {
  // Navigation — board nav geometry.
  overview: "M4 11l8-6 8 6v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z",
  workspace: "M4 7h4M4 12h4M4 17h4M11 7h9M11 12h9M11 17h9",
  locations:
    "M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10zM12 11.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z",
  assets: "M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9",
  schedule: "M4 6h16v14H4zM4 10h16M9 4v4M15 4v4",
  // Evidence is the board's "reports" document glyph: a page with a folded
  // corner. Evidence is captured record, and that reads correctly.
  evidence: "M6 4h9l4 4v12H6zM14 4v5h5",
  // Approvals is the board's "compliance" shield — a decision that vouches.
  approvals: "M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z",
  capabilities: "M12 3l8 4.5v9L12 21l-8-4.5v-9z",
  configuration:
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4.5 12l-1-2 2-3 2.3.6 1.7-1L10 4h4l.5 2.6 1.7 1 2.3-.6 2 3-1 2 1 2-2 3-2.3-.6-1.7 1L14 20h-4l-.5-2.6-1.7-1L5.5 17l-2-3z",
  audit: "M5 19V9M10 19V5M15 19v-7M20 19v-3",

  // Trading vocabulary. These were referenced by the plywood navigation before
  // they existed here, and `isIconName` silently dropped them — the nav items
  // rendered with no glyph at all. Thin outline, single stroke weight, matching
  // the brand sheet.
  //
  // catalogue: stacked boards seen edge-on, which is what the product IS.
  catalogue: "M4 7h16M4 12h16M4 17h16M7 5v14",
  // parties: two figures. Supplier and customer are the same shape of record.
  parties:
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-3.3 2.7-5 6-5s6 1.7 6 5M17 10.5a2.5 2.5 0 1 0 0-5M18 20c0-2.4-.8-3.9-2-4.6",
  // purchases: a box arriving — arrow pointing into the container.
  purchases: "M20 8.5v9L12 21l-8-3.5v-9M4 8.5L12 5l8 3.5-8 3.5zM12 12v9",
  // sales: a tag, which is the moment a price is attached to a board.
  sales: "M4 4h7l9 9-7 7-9-9zM8.5 8.5h.01",
  // stock: shelves. What physically exists, on racks, in a godown.
  stock: "M4 5h16v5H4zM4 14h16v5H4zM8 5v5M16 14v5",
  // tax: a document with a percentage on it.
  tax: "M6 3h9l4 4v14H6zM14 3v5h5M10 11l4 6M10.5 11.5h.01M13.5 16.5h.01",
  // supplier: goods arriving from outside — an arrow into a crate. Suppliers
  // and Customers sit next to each other in TRADE and shared one glyph, which
  // made the two halves of the business look like one item repeated.
  supplier: "M4 10.5V19h16v-8.5M12 3v8M12 11l-3-3M12 11l3-3M3 10.5h18",
  // finance: a banknote. Money that has been billed and is moving, which is
  // what Finance is about — distinct from the bar chart, which belongs to
  // Reports, and from the book, which belongs to Ledgers. Three nav items
  // sharing one glyph made the sidebar unreadable at a glance.
  finance:
    "M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM6 10v4M18 10v4",
  // ledger: a bound book seen from the spine side, with ruled lines. A ledger
  // is a record you read down, not a chart you read across.
  ledger: "M5 4h13a1 1 0 0 1 1 1v15H6a1 1 0 0 1-1-1zM5 17h14M9 8h6M9 11h6",
  // people: a figure with a badge — identity plus what they may do.
  people:
    "M12 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM5 21c0-3.9 3.1-6 7-6s7 2.1 7 6",

  // Chrome.
  search: "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM16.5 16.5L21 21",
  bell: "M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6M10.5 20a2 2 0 0 0 3 0",
  collapse: "M15 6l-6 6 6 6",
  expand: "M9 6l6 6-6 6",
  signOut: "M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 8l-4 4 4 4M6 12h9",
  sun: "M12 5V3M12 21v-2M5 12H3M21 12h-2M6.3 6.3L4.9 4.9M19.1 19.1l-1.4-1.4M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  moon: "M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z",
  system: "M4 5h16v10H4zM9 19h6M12 15v4",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 6l6 6-6 6",
  building: "M5 20V8l7-4 7 4v12M10 20v-5h4v5",
  check: "M5 12.5l4.5 4.5L19 7.5",
  close: "M6 6l12 12M18 6L6 18",
  // Task 84 area 6 — the chat dock toggle. A speech bubble, not a spark or a
  // robot head: the assistant is a conversation with the platform's own
  // authority, not a separate branded feature (ADR-017).
  assistant: "M4 5h16v11H9l-4 4z M8.5 9.5h7 M8.5 12.5h4.5",
  // Sign-in field prefixes.
  mail: "M4 6h16v12H4zM4 7l8 6 8-6",
  lock: "M6 11V8a6 6 0 1 1 12 0v3M5 11h14v9H5zM12 15v2",
  eye: "M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  eyeOff:
    "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M6.5 6.9C4 8.6 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.6 0 3-.4 4.2-1.1M17.6 17.5C19.9 15.9 21.5 12 21.5 12S18 5.5 12 5.5c-.7 0-1.5.1-2.1.3",
  plus: "M12 5v14M5 12h14",
  // eyedropper: the sampling tool's own silhouette — an angled pen tip picking
  // a point off the canvas. Used only by the accent picker's sample-from-screen
  // control, so it reads as a color instrument rather than a generic pointer.
  eyedropper:
    "M17.5 3.5a2.8 2.8 0 0 1 4 4L19 10 14 5zM14 5l-8.5 8.5-2 5.5 5.5-2z M9.5 15l-1.7-1.7",
  // Three zero-length segments with the shared round linecap render as dots —
  // no separate dot-drawing code needed for a stroke-based icon set.
  moreHorizontal: "M5 12h.01M12 12h.01M19 12h.01",

  // Navigation glyphs that capabilities already named but this set never had.
  // `isIconName` drops an unknown name silently, so these seven nav items
  // (Guests, Complaints, Recipes, Expenses, Coupons, Cash reconciliation,
  // Attendance, Manufacturing) rendered with no glyph at all. A test now fails
  // when a capability names an icon that is not here.
  // book: an open recipe book, spine at the left.
  book: "M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3zM5 17a3 3 0 0 1 3-3h11",
  // clock: attendance is time on the job.
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  // flag: a complaint raised.
  flag: "M6 21V4M6 5h11l-2 4 2 4H6",
  // manufacturing: a sawtooth-roof works.
  manufacturing: "M4 20V11l5 3v-3l5 3V5h4v15zM4 20h16",
  // tag: a coupon, notched ticket with a tear line.
  tag: "M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4zM14 7v10",
  // user: one guest — head and shoulders in a rounded frame.
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 20a8 8 0 0 1 16 0",
  // wallet: money kept, expenses and cash counted.
  wallet: "M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4zM4 7V6a2 2 0 0 1 2-2h11M16 14h.01",
};

export function Icon({
  name,
  size = 16.5,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: "none" }}
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** Narrows an arbitrary string to an icon this set actually ships. */
export function isIconName(value: string | undefined): value is IconName {
  return value !== undefined && value in PATHS;
}
