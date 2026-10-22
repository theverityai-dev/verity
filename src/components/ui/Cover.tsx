import Image from "next/image";

/**
 * A lot, bundle or record picture: the photograph when there is one, else a typed tile carrying the lot number, so a card is never
 * blank (screen-imagery). Photographs arrive as short-lived storage links or as the demo tenant's own stills, so they are not run
 * through the image optimiser.
 */
export function Cover({ src, label, size = 56, rounded = 12 }: { src: string | null; label: string; size?: number; rounded?: number }) {
  const box = { width: size, height: size, borderRadius: rounded };
  if (src) return <Image src={src} alt="" width={size} height={size} unoptimized className="shrink-0 object-cover" style={box} />;
  return (
    <span aria-hidden="true" className="grid shrink-0 place-items-center bg-[var(--color-control)] text-[11px] font-medium tracking-[0.04em] text-text-secondary" style={box}>
      {label.replace(/^LOT-0*/, "L")}
    </span>
  );
}
