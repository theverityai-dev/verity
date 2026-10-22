import { Icon, type IconName } from "./icons";
import { KIND_HUES, STATE_TONES, kindPresentation, type KindHue, type StateTone } from "./business/domains";

/**
 * A glyph on a soft tinted shape: "what sort of thing is this" (ADR-046).
 *
 * `IconTile` (rounded square) is for list rows and cards; `IconDisc` (circle) is for KPI tiles and
 * numbered markers. Pass either a `kind` (the mapped hue and glyph from `domains.ts`, the normal
 * route) or an explicit `icon` and `hue`. Colour comes from the tokens by inline `var()`, so there
 * is no per-page colour and no dynamic class for Tailwind to miss.
 *
 * `state` is the one exception to kind colouring: a KPI disc that counts things in a single
 * `StateCategory` takes that state's pill colours (ADR-046 §2). It wins over `hue` and `kind`.
 *
 * The glyph is decorative (`aria-hidden`): a visible label always sits beside it. Kind hues are for
 * this component, avatars and chart series only; never use them on a pill or a button.
 */

type Shape = "tile" | "disc";
type Size = "sm" | "md" | "lg";

const BOX: Record<Size, string> = {
  sm: "size-7",
  md: "size-9",
  lg: "size-11",
};
const GLYPH: Record<Size, number> = { sm: 15, md: 18, lg: 22 };

export type IconTileProps = {
  /** A kind from `domains.ts` (sets hue and glyph). */
  kind?: string;
  /** Override or supply the glyph when no kind is given. */
  icon?: IconName;
  /** Override or supply the hue when no kind is given. */
  hue?: KindHue;
  /** A state count disc: colour from the state system instead of a kind hue. */
  state?: StateTone;
  size?: Size;
  className?: string;
};

/** Fill and ink `var()`s for a tile. Exported for components that draw their own shape (charts, avatars). */
export function tileColours({ kind, hue, state }: Pick<IconTileProps, "kind" | "hue" | "state">) {
  if (state && (STATE_TONES as readonly string[]).includes(state)) {
    return { fill: `var(--color-state-${state}-fill)`, ink: `var(--color-state-${state}-on)` };
  }
  const tone = hue ?? (kind ? kindPresentation(kind).hue : undefined) ?? "slate";
  const safe = (KIND_HUES as readonly string[]).includes(tone) ? tone : "slate";
  return { fill: `var(--color-hue-${safe}-fill)`, ink: `var(--color-hue-${safe}-on)` };
}

function Tile({ shape, kind, icon, hue, state, size = "md", className }: IconTileProps & { shape: Shape }) {
  const glyph = icon ?? (kind ? kindPresentation(kind).icon : undefined) ?? "workspace";
  const { fill, ink } = tileColours({ kind, hue, state });
  return (
    <span
      aria-hidden="true"
      className={[
        "inline-flex shrink-0 items-center justify-center",
        shape === "disc" ? "rounded-full" : "rounded-[10px]",
        BOX[size],
        className ?? "",
      ].join(" ")}
      style={{ backgroundColor: fill, color: ink }}
    >
      <Icon name={glyph} size={GLYPH[size]} />
    </span>
  );
}

export function IconTile(props: IconTileProps) {
  return <Tile shape="tile" {...props} />;
}

export function IconDisc(props: IconTileProps) {
  return <Tile shape="disc" {...props} />;
}
