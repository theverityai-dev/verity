/**
 * Entity keys, channel names and configuration keys of the dine-in capability.
 *
 * Kept apart from `index.ts` so the capability's other modules (reports, GST,
 * kitchen, prices, self-order) can import them without a circular import back
 * into the file that registers them. `index.ts` re-exports everything here, so
 * existing imports of these names from `@/server/capabilities/dinein` keep working.
 */

export const DINEIN_CAPABILITY = "verity.capability.dinein";

export const ENTITY_MENU_CATEGORY = "verity.dinein.menu_category";
export const ENTITY_MENU_ITEM = "verity.dinein.menu_item";
export const ENTITY_MENU_VARIANT = "verity.dinein.menu_variant";
export const ENTITY_ZONE = "verity.dinein.zone";
export const ENTITY_TABLE = "verity.dinein.table";
export const ENTITY_ORDER = "verity.dinein.order";
export const ENTITY_ORDER_LINE = "verity.dinein.order_line";
export const ENTITY_BILL = "verity.dinein.bill";
export const ENTITY_PAYMENT = "verity.dinein.payment";

/** Configuration keys this capability reads. Rates vary; arithmetic does not. */
export const CONFIG_CGST_RATE = "verity.dinein.tax.cgst_rate";
export const CONFIG_SGST_RATE = "verity.dinein.tax.sgst_rate";
export const CONFIG_PREP_TARGET_MINUTES = "verity.dinein.kitchen.prep_target_minutes";
/** Outlet attention thresholds (Task 126 1.2). Minutes. */
export const CONFIG_ALERT_UNPAID_MINUTES = "verity.dinein.alerts.unpaid_minutes";
export const CONFIG_ALERT_SEATED_MINUTES = "verity.dinein.alerts.seated_minutes";
export const DEFAULT_ALERT_UNPAID_MINUTES = 15;
export const DEFAULT_ALERT_SEATED_MINUTES = 60;

/**
 * Where an order came from (Colonel Kebabz PRD §9: "order source must be
 * stored"). Only `dine_in` sits at a table; a database CHECK enforces that a
 * dine-in order always has one. Closed set, same reasoning as MOVEMENT_KINDS.
 */
export const ORDER_CHANNELS = [
  "dine_in",
  "takeaway",
  "phone",
  "delivery",
  "delivery_platform",
  "website",
  "qr",
  "corporate",
  "catering",
] as const;
export type OrderChannel = (typeof ORDER_CHANNELS)[number];

export const ORDER_CHANNEL_LABEL: Record<OrderChannel, string> = {
  dine_in: "Dine-in",
  takeaway: "Takeaway",
  phone: "Phone order",
  delivery: "Own delivery",
  delivery_platform: "Delivery platform",
  website: "Website",
  qr: "QR order",
  corporate: "Corporate",
  catering: "Catering",
};
