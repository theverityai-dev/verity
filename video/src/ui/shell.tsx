import React from "react";
import { V } from "../film/layout";
import { Icon, type IconName } from "./icons";
import { ui } from "./kit";

/**
 * The Verity mark. Geometry copied verbatim from `src/components/brand/VerityMark.tsx`
 * (fitted to the approved raster; do not adjust). Monochrome, always (ADR-012).
 */
const TOP = "M 2 0 H 14.613 A 2 2 0 0 1 16.1432 3.288 L 9.4078 11.283 A 1.3135 1.3135 0 0 0 7.2052 11.283 L 0.4698 3.288 A 2 2 0 0 1 2 0 Z";
const BOTTOM = "M 2 24 H 14.613 A 2 2 0 0 0 16.1432 20.712 L 9.4078 12.717 A 1.3135 1.3135 0 0 1 7.2052 12.717 L 0.4698 20.712 A 2 2 0 0 0 2 24 Z";
export const SYMBOL_RATIO = 0.6922;

export const VeritySymbol: React.FC<{ size: number; color?: string; top?: number; bottom?: number }> = ({ size, color = "currentColor", top = 1, bottom = 1 }) => (
  <svg width={size * SYMBOL_RATIO} height={size} viewBox="0 0 16.613 24" style={{ display: "block", flex: "none", overflow: "visible" }}>
    <path d={TOP} fill={color} opacity={top} />
    <path d={BOTTOM} fill={color} opacity={bottom} />
  </svg>
);

/** The wordmark as the product now sets it: Inter 300, -0.04em, lower case. */
export const VerityWordmark: React.FC<{ size: number; color?: string }> = ({ size, color = "currentColor" }) => (
  <span style={{ ...ui, display: "block", fontSize: size * 0.95, fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1, color }}>verity</span>
);

/** Lockup metrics from VerityMark.tsx: symbol 0.865 of the wordmark size, gap 0.38. */
export const VerityLockup: React.FC<{ size: number; color?: string }> = ({ size, color = V.text }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: size * 0.38, color }}>
    <VeritySymbol size={size * 0.865} color={color} />
    <VerityWordmark size={size} color={color} />
  </span>
);

/* --------------------------------- sidebar --------------------------------- */

type NavItem = { label: string; icon: IconName; key: string };
const NAV: Array<{ group?: string; items: NavItem[] }> = [
  { items: [{ label: "Summary", icon: "home", key: "summary" }] },
  {
    group: "Trade",
    items: [
      { label: "Pipeline", icon: "enquiry", key: "pipeline" },
      { label: "Companies", icon: "building", key: "companies" },
      { label: "Follow-ups", icon: "clock", key: "followups" },
      { label: "Customers", icon: "people", key: "customers" },
      { label: "Jobs", icon: "list", key: "jobs" },
    ],
  },
  {
    group: "Production",
    items: [
      { label: "Manufacturing orders", icon: "orders", key: "orders" },
      { label: "Bills of materials", icon: "doc", key: "boms" },
      { label: "Shop floor", icon: "pulse", key: "floor" },
      { label: "Routes", icon: "route", key: "routes" },
      { label: "Batches", icon: "grid", key: "batches" },
      { label: "Documents", icon: "quote", key: "documents" },
    ],
  },
  { group: "Inventory", items: [{ label: "Inventory", icon: "stack", key: "inventory" }, { label: "Purchase orders", icon: "cube", key: "pos" }] },
  { group: "Money", items: [{ label: "Accounting", icon: "book", key: "accounting" }] },
  { group: "Administration", items: [{ label: "People operations", icon: "person", key: "people" }, { label: "Roles", icon: "key", key: "roles" }] },
];

export type NavKey = string;

/** iPadOS sidebar: bar material, selected row = tint fill with white label; tinted glyphs. */
export const Sidebar: React.FC<{ active: NavKey; collapsed?: boolean }> = ({ active, collapsed }) => (
  <div
    style={{
      width: collapsed ? 76 : 240,
      flex: "none",
      background: V.chrome,
      borderRight: `1px solid ${V.line}`,
      padding: collapsed ? "22px 14px" : "22px 15px",
      display: "flex",
      flexDirection: "column",
      gap: 2,
    }}
  >
    <div style={{ display: "flex", alignItems: "center", justifyContent: collapsed ? "center" : "space-between", padding: collapsed ? "0 0 26px" : "0 8px 26px" }}>
      {collapsed ? <VeritySymbol size={26} color={V.text} /> : <VerityLockup size={30} />}
      {!collapsed && <Icon name="chevronLeft" size={16} color={V.text3} />}
    </div>
    {NAV.map((g, gi) => (
      <div key={gi} style={{ marginBottom: 10 }}>
        {g.group && !collapsed && <div style={{ fontSize: 13, fontWeight: 600, color: V.text2, padding: "8px 11px 6px" }}>{g.group}</div>}
        {g.group && collapsed && <div style={{ height: 1, background: V.line, margin: "8px 6px 10px" }} />}
        {g.items.map((it) => {
          const on = it.key === active;
          return (
            <div
              key={it.key}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: collapsed ? "center" : undefined,
                gap: 14,
                height: 38,
                padding: collapsed ? 0 : "0 11px",
                borderRadius: 10,
                background: on ? V.accent : undefined,
                color: on ? "#FFFFFF" : V.text,
                fontSize: 15,
                fontWeight: on ? 600 : 400,
                marginBottom: 3,
              }}
            >
              <Icon name={it.icon} size={19} color={on ? "#FFFFFF" : V.accent} />
              {!collapsed && it.label}
            </div>
          );
        })}
      </div>
    ))}
  </div>
);

/** Top bar: search field with the shortcut hint, theme, assistant, notifications, avatar. */
export const TopBar: React.FC<{ assistantOn?: number }> = ({ assistantOn = 0 }) => (
  <div style={{ height: 76, flex: "none", display: "flex", alignItems: "center", gap: 14, padding: "0 30px" }}>
    <div style={{ width: 560, height: 36, borderRadius: 10, background: V.control, display: "flex", alignItems: "center", gap: 8, padding: "0 12px", color: V.text3, fontSize: 15 }}>
      <Icon name="search" size={16} />
      <span style={{ flex: 1 }}>Search</span>
      <span style={{ fontSize: 13 }}>Ctrl K</span>
    </div>
    <span style={{ width: 34, height: 34, borderRadius: 9, background: V.surface, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon name="sun" size={17} color={V.text} />
    </span>
    <span
      style={{
        width: 40,
        height: 40,
        borderRadius: 20,
        background: assistantOn ? `rgba(11, 101, 179, ${0.15 + 0.85 * assistantOn})` : V.controlStrong,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Icon name="chat" size={18} color={assistantOn > 0.5 ? "#FFF" : V.text} />
    </span>
    <span style={{ width: 40, height: 40, borderRadius: 20, background: V.controlStrong, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <Icon name="bell" size={18} color={V.text} />
    </span>
    <span style={{ width: 42, height: 42, borderRadius: 21, background: "#D8E7FA", border: `1px solid ${V.accentLine}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, color: V.accent, fontWeight: 500 }}>
      VS
    </span>
  </div>
);

/**
 * The application window: canvas, sidebar, top bar and a content column. Logical size 1440 x 1000,
 * the size of the reference screenshots; the scene's camera decides its on-screen scale.
 */
export const AppWindow: React.FC<{
  active: NavKey;
  collapsed?: boolean;
  width?: number;
  height?: number;
  children: React.ReactNode;
  assistantOn?: number;
  overlay?: React.ReactNode;
  contentStyle?: React.CSSProperties;
}> = ({ active, collapsed, width = 1440, height = 1000, children, assistantOn, overlay, contentStyle }) => (
  <div
    style={{
      ...ui,
      width,
      height,
      background: V.canvas,
      borderRadius: 18,
      overflow: "hidden",
      display: "flex",
      position: "relative",
      // Contact shadow plus one long soft shadow, at most 0.5 alpha (skill section 5).
      boxShadow: "0 1px 2px rgba(0,0,0,0.35), 0 30px 80px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.9)",
    }}
  >
    <Sidebar active={active} collapsed={collapsed} />
    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
      <TopBar assistantOn={assistantOn} />
      <div style={{ flex: 1, minHeight: 0, padding: "4px 30px 30px", position: "relative", ...contentStyle }}>{children}</div>
    </div>
    {overlay}
  </div>
);

/** Breadcrumb above a record title ("Jobs > J-0142"). */
export const Crumb: React.FC<{ parent: string; here: string }> = ({ parent, here }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 16, marginBottom: 6 }}>
    <span style={{ color: V.accent }}>{parent}</span>
    <Icon name="chevronRight" size={14} color={V.text3} />
    <span style={{ color: V.text2 }}>{here}</span>
  </div>
);
