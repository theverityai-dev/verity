import { KIND_HUES } from "./business/domains";
import { initials, stableIndex } from "./viz-geometry";

/**
 * Initials on a kind hue (ADR-046 §3: avatars are one of the four places kind hues may appear).
 * The hue is a stable function of the name, so a person or customer keeps one colour on every
 * screen. Decorative: the name is always shown beside it, so the avatar is `aria-hidden`.
 */
export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const hue = KIND_HUES[stableIndex(name, KIND_HUES.length)]!;
  return (
    <span
      aria-hidden="true"
      title={name}
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        backgroundColor: `var(--color-hue-${hue}-fill)`,
        color: `var(--color-hue-${hue}-ink)`,
      }}
    >
      {initials(name)}
    </span>
  );
}
