"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@/components/ui/icons";

/**
 * Freeform accent picker — a saturation/value field plus a hue ring, not a
 * shortlist of swatches. ADR-012's ten presets remain reachable as "Quick
 * picks" underneath, but they are no longer the mechanism: the brief was
 * "single color picker for all kinds of colors not some options", so the
 * field is the primary surface and presets are one-tap shortcuts into it.
 *
 * Dragging previews live across the whole shell (`onPreview` — a direct
 * style write, no cookie, no refresh) so every accent-derived surface in the
 * product visibly repaints as the thumb moves. Only release/blur/quick-pick
 * commits (`onCommit` — cookie + `router.refresh()`), so a drag never floods
 * the server with a refresh per pointer-move.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function hexToRgb(hex: string): [number, number, number] {
  const n = hex.replace("#", "");
  return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`.toUpperCase();
}

function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  return { h, s: s * 100, v: max * 100 };
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const sN = s / 100;
  const vN = v / 100;
  const c = vN * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vN - c;
  const [r, g, b] =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsv(r, g, b);
}

function hsvToHex(h: number, s: number, v: number): string {
  const [r, g, b] = hsvToRgb(h, s, v);
  return rgbToHex(r, g, b);
}

/** Same rule as `onAccentFor` on the server — the thumb ring needs to sit legibly on any fill. */
function inkFor(hex: string): string {
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = (h: string) => {
    const [r, g, b] = hexToRgb(h);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  return ratio(hex, "#191A1C") >= ratio(hex, "#FFFFFF") ? "#191A1C" : "#FFFFFF";
}

export function AccentPicker({
  initialHex,
  presets,
  onPreview,
  onCommit,
}: {
  initialHex: string;
  presets: ReadonlyArray<{ name: string; hex: string }>;
  onPreview: (hex: string) => void;
  onCommit: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState(() => hexToHsv(initialHex));
  const [hexDraft, setHexDraft] = useState(initialHex);
  const [pickingScreen, setPickingScreen] = useState(false);
  const [supportsEyedropper, setSupportsEyedropper] = useState(false);
  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"square" | "hue" | null>(null);
  const hsvRef = useRef(hsv);

  const hex = useMemo(() => hsvToHex(hsv.h, hsv.s, hsv.v), [hsv]);
  const ink = useMemo(() => inkFor(hex), [hex]);
  const pureHueHex = useMemo(() => hsvToHex(hsv.h, 100, 100), [hsv.h]);

  useEffect(() => {
    hsvRef.current = hsv;
    setHexDraft(hex);
    onPreview(hex);
  }, [hsv, hex, onPreview]);

  useEffect(() => {
    setSupportsEyedropper(typeof window !== "undefined" && "EyeDropper" in window);
  }, []);

  function updateFromSquare(clientX: number, clientY: number) {
    const el = squareRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const s = clamp(((clientX - rect.left) / rect.width) * 100, 0, 100);
    const v = clamp(100 - ((clientY - rect.top) / rect.height) * 100, 0, 100);
    setHsv((prev) => ({ ...prev, s, v }));
  }

  function updateFromHue(clientX: number) {
    const el = hueRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const h = clamp(((clientX - rect.left) / rect.width) * 360, 0, 360);
    setHsv((prev) => ({ ...prev, h }));
  }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (draggingRef.current === "square") updateFromSquare(e.clientX, e.clientY);
      else if (draggingRef.current === "hue") updateFromHue(e.clientX);
    }
    function onUp() {
      if (draggingRef.current) {
        const { h, s, v } = hsvRef.current;
        onCommit(hsvToHex(h, s, v));
      }
      draggingRef.current = null;
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [onCommit]);

  function commitHexDraft(value: string) {
    if (!HEX.test(value)) return;
    const upper = value.toUpperCase();
    setHsv(hexToHsv(upper));
    onCommit(upper);
  }

  async function sampleFromScreen() {
    // @ts-expect-error — EyeDropper is not yet in TS's lib.dom types.
    const dropper = new window.EyeDropper();
    setPickingScreen(true);
    try {
      const result = await dropper.open();
      const sampled = String(result.sRGBHex).toUpperCase();
      if (HEX.test(sampled)) {
        setHsv(hexToHsv(sampled));
        onCommit(sampled);
      }
    } catch {
      // User cancelled the sample (Escape) — no-op.
    } finally {
      setPickingScreen(false);
    }
  }

  function nudgeSquare(dx: number, dy: number) {
    const next = { ...hsv, s: clamp(hsv.s + dx, 0, 100), v: clamp(hsv.v + dy, 0, 100) };
    setHsv(next);
    onCommit(hsvToHex(next.h, next.s, next.v));
  }

  function nudgeHue(dh: number) {
    const next = { ...hsv, h: clamp(hsv.h + dh, 0, 360) };
    setHsv(next);
    onCommit(hsvToHex(next.h, next.s, next.v));
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Live headline swatch — the field's own output, read at a glance before touching anything. */}
      <div
        className="flex h-16 items-center justify-between rounded-xl px-4 transition-colors duration-150"
        style={{ background: hex, color: ink }}
      >
        <span className="text-[13px] font-semibold">Accent</span>
        <span className="font-mono text-[13px] tabular-nums">{hex}</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        {/* Saturation/value field. */}
        <div
          ref={squareRef}
          role="slider"
          tabIndex={0}
          aria-label="Accent saturation and brightness"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(hsv.v)}
          aria-valuetext={`saturation ${Math.round(hsv.s)}%, brightness ${Math.round(hsv.v)}%`}
          onPointerDown={(e) => {
            draggingRef.current = "square";
            updateFromSquare(e.clientX, e.clientY);
          }}
          onKeyDown={(e) => {
            const step = e.shiftKey ? 10 : 2;
            if (e.key === "ArrowRight") nudgeSquare(step, 0);
            else if (e.key === "ArrowLeft") nudgeSquare(-step, 0);
            else if (e.key === "ArrowUp") nudgeSquare(0, step);
            else if (e.key === "ArrowDown") nudgeSquare(0, -step);
            else return;
            e.preventDefault();
          }}
          className="relative h-56 w-full shrink-0 cursor-crosshair touch-none rounded-xl ring-1 ring-inset ring-[var(--color-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-line)] sm:w-56"
          style={{
            backgroundColor: pureHueHex,
            backgroundImage:
              "linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)",
          }}
        >
          <span
            aria-hidden="true"
            className="absolute size-4 -translate-x-1/2 translate-y-1/2 rounded-full shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
            style={{
              left: `${hsv.s}%`,
              bottom: `${hsv.v}%`,
              border: `2px solid ${ink}`,
              background: hex,
            }}
          />
        </div>

        <div className="flex flex-1 flex-col gap-3">
          {/* Hue as a bar rather than a ring — a wheel earns nothing extra here
              and costs pointer-math complexity the bar does not have. */}
          <div
            ref={hueRef}
            role="slider"
            tabIndex={0}
            aria-label="Accent hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            onPointerDown={(e) => {
              draggingRef.current = "hue";
              updateFromHue(e.clientX);
            }}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 20 : 4;
              if (e.key === "ArrowRight") nudgeHue(step);
              else if (e.key === "ArrowLeft") nudgeHue(-step);
              else return;
              e.preventDefault();
            }}
            className="relative h-9 w-full cursor-pointer touch-none rounded-full ring-1 ring-inset ring-[var(--color-line-strong)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-line)]"
            style={{
              background:
                "linear-gradient(to right, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)",
            }}
          >
            <span
              aria-hidden="true"
              className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
              style={{ left: `${(hsv.h / 360) * 100}%`, background: pureHueHex }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="accent-hex" className="text-[12px] text-text-tertiary">
              Hex
            </label>
            <input
              id="accent-hex"
              value={hexDraft}
              onChange={(e) => setHexDraft(e.target.value)}
              onBlur={() => commitHexDraft(hexDraft)}
              onKeyDown={(e) => e.key === "Enter" && commitHexDraft(hexDraft)}
              spellCheck={false}
              className="verity-solid h-10 flex-1 rounded-[10px] px-3 font-mono text-[13px] text-text"
            />
            {supportsEyedropper && (
              <button
                type="button"
                onClick={sampleFromScreen}
                disabled={pickingScreen}
                title="Sample a color from your screen"
                aria-label="Sample a color from your screen"
                className="verity-solid inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[10px] text-text-secondary transition-colors hover:text-text disabled:cursor-wait disabled:opacity-60"
              >
                <Icon name="eyedropper" size={17} />
              </button>
            )}
          </div>
          {!HEX.test(hexDraft) && (
            <span role="alert" className="text-[12px] text-danger">
              Six-digit hex, e.g. #D4A017
            </span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 mt-0 text-[12px] text-text-tertiary">Quick picks</p>
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <button
              key={p.hex}
              type="button"
              onClick={() => {
                setHsv(hexToHsv(p.hex));
                onCommit(p.hex);
              }}
              title={`${p.name} — ${p.hex}`}
              aria-label={`${p.name} — ${p.hex}`}
              aria-pressed={hex.toUpperCase() === p.hex.toUpperCase()}
              className={
                "size-7 shrink-0 cursor-pointer rounded-full ring-1 ring-[var(--color-line-strong)] transition-transform hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-accent-line)] " +
                (hex.toUpperCase() === p.hex.toUpperCase() ? "scale-110 ring-2 ring-[var(--color-accent-line)]" : "")
              }
              style={{ background: p.hex }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
