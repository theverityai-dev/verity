import React from "react";
import { FEATURES, FONT, HUE, STATE, V, type Hue, type StateKey } from "../film/layout";
import { Icon, type IconName } from "./icons";

/**
 * Verity UI, light theme, at the product's own CSS pixel sizes (1x = the 1440px screenshots).
 * Measurements are copied from `src/components/ui/primitives.tsx` and `src/app/globals.css`
 * (ADR-033); the scene camera scales the whole window, never individual pieces.
 */

export const ui: React.CSSProperties = {
  fontFamily: FONT,
  fontFeatureSettings: FEATURES,
  color: V.text,
  WebkitFontSmoothing: "antialiased",
  letterSpacing: "-0.005em",
};

export const tab: React.CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** `.glass-card`: an opaque inset-grouped cell, 12px corners, no border, no shadow. */
export const Cell: React.FC<{ children: React.ReactNode; style?: React.CSSProperties; pad?: number }> = ({ children, style, pad = 20 }) => (
  <div style={{ background: V.surface, borderRadius: 12, padding: pad, ...style }}>{children}</div>
);

/** `Panel`: a cell with a Headline (17 semibold) title inside its padding, no rule under it. */
export const Panel: React.FC<{ title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties; flush?: boolean }> = ({
  title,
  action,
  children,
  style,
  flush,
}) => (
  <div style={{ background: V.surface, borderRadius: 12, overflow: "hidden", ...style }}>
    {title && (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: `16px 20px ${flush ? 12 : 4}px` }}>
        <div style={{ fontSize: 17, lineHeight: "22px", fontWeight: 600, letterSpacing: "-0.02em" }}>{title}</div>
        {action}
      </div>
    )}
    <div style={flush ? undefined : { padding: title ? "12px 20px 20px" : 20 }}>{children}</div>
  </div>
);

/** Large Title 34/41 bold (globals.css h1). */
export const LargeTitle: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontSize: 34, lineHeight: "41px", fontWeight: 700, letterSpacing: "0.01em", ...style }}>{children}</div>
);

export const Footnote: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ fontSize: 13, lineHeight: "18px", color: V.text3, ...style }}>{children}</div>
);

/** iOS grouped-list section header: footnote, uppercase, secondary. */
export const SectionHeading: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div style={{ fontSize: 13, lineHeight: "18px", textTransform: "uppercase", letterSpacing: "0.02em", color: V.text2, padding: "0 16px", marginBottom: 8 }}>{children}</div>
);

/** `StateBadge`: tinted opaque fill of the state colour, a dot and a word (ADR-046 section 5). */
export const StateBadge: React.FC<{ state: StateKey; label: string; style?: React.CSSProperties }> = ({ state, label, style }) => {
  const s = STATE[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        whiteSpace: "nowrap",
        borderRadius: 999,
        padding: "2px 10px 2px 8px",
        fontSize: 13,
        lineHeight: "18px",
        fontWeight: 500,
        background: s.fill,
        color: s.ink,
        ...style,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: 4, background: s.dot, flex: "none" }} />
      {label}
    </span>
  );
};

/** Neutral provenance pill (`Badge`). */
export const Badge: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ display: "inline-flex", alignItems: "center", borderRadius: 6, padding: "2px 8px", fontSize: 13, lineHeight: "18px", fontWeight: 500, background: V.controlStrong, color: V.text, ...tab, ...style }}>
    {children}
  </span>
);

/** iOS buttons: filled (primary), gray (secondary, tint label), plain (ghost), destructive-tinted. */
export const Button: React.FC<{
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  pressed?: number;
  style?: React.CSSProperties;
}> = ({ children, variant = "secondary", size = "md", pressed = 0, style }) => {
  const look: Record<string, React.CSSProperties> = {
    primary: { background: V.accent, color: "#FFFFFF" },
    secondary: { background: V.control, color: V.accent },
    ghost: { background: "transparent", color: V.accent },
    danger: { background: V.dangerSubtle, color: V.danger },
  };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: size === "sm" ? 32 : 40,
        padding: size === "sm" ? "0 12px" : "0 16px",
        borderRadius: 10,
        fontSize: size === "sm" ? 15 : 16,
        fontWeight: 600,
        whiteSpace: "nowrap",
        // Press dims, as on iOS.
        opacity: 1 - 0.35 * pressed,
        transform: `scale(${1 - 0.02 * pressed})`,
        ...look[variant],
        ...style,
      }}
    >
      {children}
    </span>
  );
};

/** `IconDisc`: a 40px kind-hued disc holding a glyph (ADR-046). */
export const IconDisc: React.FC<{ icon: IconName; hue?: Hue; size?: number }> = ({ icon, hue = "slate", size = 40 }) => (
  <span style={{ width: size, height: size, borderRadius: size / 2, background: HUE[hue].fill, color: HUE[hue].ink, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
    <Icon name={icon} size={size * 0.5} />
  </span>
);

/** `StatTile`: disc, value (28 bold, tabular), label (15 secondary), hint (13 tertiary). */
export const StatTile: React.FC<{
  icon: IconName;
  hue?: Hue;
  value: React.ReactNode;
  label: string;
  hint?: React.ReactNode;
  viz?: React.ReactNode;
  style?: React.CSSProperties;
  highlight?: number;
}> = ({ icon, hue, value, label, hint, viz, style, highlight = 0 }) => (
  <div
    style={{
      background: V.surface,
      borderRadius: 12,
      padding: 20,
      display: "flex",
      flexDirection: "column",
      gap: 12,
      boxShadow: highlight ? `inset 0 0 0 ${2 * highlight}px ${V.accentLine}` : undefined,
      ...style,
    }}
  >
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
      <IconDisc icon={icon} hue={hue} />
      {viz}
    </div>
    <div>
      <div style={{ fontSize: 28, lineHeight: "34px", fontWeight: 700, ...tab }}>{value}</div>
      <div style={{ fontSize: 15, lineHeight: "20px", color: V.text2, marginTop: 2 }}>{label}</div>
      {hint && <div style={{ fontSize: 13, lineHeight: "18px", color: V.text3, marginTop: 4 }}>{hint}</div>}
    </div>
  </div>
);

/** Progress ring, as on the order and job tiles. `k` is 0..1. */
export const Ring: React.FC<{ k: number; size?: number; color?: string }> = ({ k, size = 44, color = V.success }) => {
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} style={{ display: "block" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={V.track} strokeWidth={3.5} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3.5}
        strokeLinecap="round"
        strokeDasharray={`${c * k} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  );
};

/** A label/value row inside a cell (`DefinitionList`), with an iOS separator beneath. */
export const DefRow: React.FC<{ term: string; value: React.ReactNode; last?: boolean }> = ({ term, value, last }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, padding: "11px 0", borderBottom: last ? undefined : `1px solid ${V.line}` }}>
    <span style={{ fontSize: 14, color: V.text2 }}>{term}</span>
    <span style={{ fontSize: 15, textAlign: "right", ...tab }}>{value}</span>
  </div>
);

/** Table header + rows sharing one column template. */
export const TableHead: React.FC<{ cols: string; heads: string[]; style?: React.CSSProperties }> = ({ cols, heads, style }) => (
  <div style={{ display: "grid", gridTemplateColumns: cols, gap: 16, padding: "10px 20px", fontSize: 13, color: V.text2, borderBottom: `1px solid ${V.line}`, ...style }}>
    {heads.map((h, i) => (
      <span key={i}>{h}</span>
    ))}
  </div>
);

export const TableRow: React.FC<{ cols: string; children: React.ReactNode; style?: React.CSSProperties; selected?: number }> = ({ cols, children, style, selected = 0 }) => (
  <div
    style={{
      display: "grid",
      gridTemplateColumns: cols,
      gap: 16,
      alignItems: "center",
      padding: "12px 20px",
      borderBottom: `1px solid ${V.line}`,
      fontSize: 15,
      background: selected ? `rgba(10, 132, 255, ${0.1 * selected})` : undefined,
      boxShadow: selected ? `inset 0 0 0 ${2 * selected}px ${V.accentLine}` : undefined,
      ...style,
    }}
  >
    {children}
  </div>
);

export const Link: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <span style={{ color: V.accent, ...style }}>{children}</span>
);

/** Capsule filter chip; selected = tint fill, white label. */
export const Chip: React.FC<{ label: string; count?: number; selected?: boolean; icon?: IconName }> = ({ label, count, selected, icon }) => (
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      height: 32,
      padding: "0 13px",
      borderRadius: 999,
      fontSize: 15,
      fontWeight: selected ? 600 : 500,
      background: selected ? V.accent : V.control,
      color: selected ? "#FFFFFF" : V.text,
      whiteSpace: "nowrap",
    }}
  >
    {icon && <Icon name={icon} size={15} />}
    {label}
    {count !== undefined && <span style={{ opacity: 0.7, ...tab }}>{count}</span>}
  </span>
);

/** The job's lifecycle stepper (Enquiry, Quoted, Approved, In production, Completed). */
export const Stepper: React.FC<{ steps: string[]; at: number }> = ({ steps, at }) => (
  <div style={{ background: V.surface, borderRadius: 12, padding: "16px 28px 14px", display: "grid", gridTemplateColumns: `repeat(${steps.length}, 1fr)`, position: "relative" }}>
    {steps.map((s, i) => {
      const done = i < at;
      const current = i === at;
      const lineDone = i < at;
      return (
        <div key={s} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, position: "relative" }}>
          {i < steps.length - 1 && (
            <div style={{ position: "absolute", top: 11, left: "50%", width: "100%", height: 2, background: V.track }}>
              <div style={{ width: `${lineDone ? 100 : 0}%`, height: 2, background: V.success }} />
            </div>
          )}
          <span
            style={{
              position: "relative",
              width: 24,
              height: 24,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              background: done ? V.success : current ? V.accent : V.controlStrong,
              color: done || current ? "#FFF" : V.text2,
              ...tab,
            }}
          >
            {done ? <Icon name="check" size={14} color="#FFF" stroke={2.2} /> : i + 1}
          </span>
          <span style={{ fontSize: 13, fontWeight: current ? 600 : 400, color: current ? V.text : V.text2 }}>{s}</span>
        </div>
      );
    })}
  </div>
);

/** Inline alert in the product's ErrorState voice: title plus the server's message. */
export const Alert: React.FC<{ title: string; message: string; tone?: "danger" | "success" | "info"; style?: React.CSSProperties }> = ({ title, message, tone = "danger", style }) => {
  const c = tone === "danger" ? { bg: "#FDEEEF", ink: V.danger, icon: "x" } : tone === "success" ? { bg: "#EAF4EC", ink: V.success, icon: "check" } : { bg: "#EAF0FD", ink: V.info, icon: "clock" };
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", background: c.bg, borderRadius: 12, padding: "14px 16px", ...style }}>
      <span style={{ width: 24, height: 24, borderRadius: 12, background: c.ink, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
        <Icon name={c.icon} size={14} color="#FFF" stroke={2.2} />
      </span>
      <div>
        <div style={{ fontSize: 15, fontWeight: 600, color: c.ink }}>{title}</div>
        <div style={{ fontSize: 14, color: V.text, marginTop: 2 }}>{message}</div>
      </div>
    </div>
  );
};
