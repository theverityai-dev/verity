"use client";

import { useEffect } from "react";

/**
 * Liquid-glass refraction — Chromium-only enhancement layer over the ADR-026
 * material classes. Authority: V2-ADR / ADR-028 (extends ADR-026; adds no
 * new surface kind — see the note in globals.css).
 *
 * It upgrades the four existing kinds (`.glass-shell`, `.glass-card`,
 * `.glass-control`, `.glass-overlay`) in place: a canvas-drawn displacement
 * map feeds an SVG `feDisplacementMap` (one pass per colour channel, for
 * chromatic aberration) and is applied through `backdrop-filter: url()`.
 * Technique: vanilla port of rdev/liquid-glass-react (skill `liquid-glass`).
 *
 * Nothing here changes markup or opts a surface in: a component that already
 * wears a glass class gets refraction; rows, badges and status dots never wear
 * one, so they never get it. Where refraction is unsupported (Safari, Firefox)
 * or the user asked for reduced transparency, nothing is touched and the
 * existing frosted blur stays. Cost is bounded: only elements intersecting the
 * viewport hold a live filter, the map is drawn at half resolution and cached
 * by size, and live filters are hard-capped.
 */

const SELECTOR = ".glass-shell, .glass-card, .glass-control, .glass-overlay";
const NS = "http://www.w3.org/2000/svg";

/** Per-kind optics. Bezel = width of the edge that bends the backdrop (px). */
function optics(el: HTMLElement) {
  if (el.matches(".glass-overlay")) return { bezel: 26, strength: 44, blur: 8 };
  if (el.matches(".glass-shell")) return { bezel: 22, strength: 30, blur: 10 };
  if (el.matches(".glass-control")) return { bezel: 10, strength: 16, blur: 6 };
  return { bezel: 18, strength: 26, blur: 8 }; // card
}

const ABERRATION = [1, 0.86, 0.72]; // R, G, B scale factors
const MAP_SCALE = 0.5; // map drawn at half size, stretched by feImage
const MAX_LIVE = 24; // hard cap on simultaneously filtered surfaces
const CHANNELS = [
  "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
];

function isChromium(): boolean {
  const brands =
    (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } })
      .userAgentData?.brands ?? [];
  return brands.some((b) => /Chromium/.test(b.brand));
}

/** Red = x shift, green = y shift, 128 neutral. Peaks at the edge, convex falloff. */
function drawMap(w: number, h: number, bezel: number): string {
  const cw = Math.max(1, Math.round(w * MAP_SCALE));
  const ch = Math.max(1, Math.round(h * MAP_SCALE));
  const b = Math.max(1, bezel * MAP_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const dl = x, dr = cw - 1 - x, dt = y, db = ch - 1 - y;
      const dx = Math.min(dl, dr), dy = Math.min(dt, db);
      const edge = Math.min(dx, dy);
      const nx = dx < b ? (dl < dr ? 1 : -1) : 0;
      const ny = dy < b ? (dt < db ? 1 : -1) : 0;
      const t = edge < b ? 1 - edge / b : 0;
      const mag = Math.pow(t, 2.2);
      const i = (y * cw + x) * 4;
      d[i] = 128 + nx * mag * 127;
      d[i + 1] = 128 + ny * mag * 127;
      d[i + 2] = 128;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

export function LiquidGlass() {
  useEffect(() => {
    if (!isChromium()) return;
    const transparency = matchMedia("(prefers-reduced-transparency: reduce)");
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    if (transparency.matches) return;

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("aria-hidden", "true");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    const defs = document.createElementNS(NS, "defs");
    svg.appendChild(defs);
    document.body.appendChild(svg);

    let uid = 0;
    const live = new Map<HTMLElement, SVGFilterElement>();
    const known = new Set<HTMLElement>();
    const mapCache = new Map<string, string>();

    const release = (el: HTMLElement) => {
      const filter = live.get(el);
      if (!filter) return;
      filter.remove();
      el.style.backdropFilter = "";
      el.classList.remove("lg-on");
      live.delete(el);
    };

    const build = (el: HTMLElement) => {
      const w = Math.round(el.offsetWidth);
      const h = Math.round(el.offsetHeight);
      if (w < 24 || h < 24) return release(el);
      if (!live.has(el) && live.size >= MAX_LIVE) return;
      const o = optics(el);
      const key = `${w}x${h}x${o.bezel}`;
      let href = mapCache.get(key);
      if (!href) {
        href = drawMap(w, h, o.bezel);
        if (mapCache.size > 40) mapCache.clear();
        mapCache.set(key, href);
      }
      if (!href) return;

      let filter = live.get(el);
      if (!filter) {
        filter = document.createElementNS(NS, "filter");
        filter.setAttribute("id", `lg-${++uid}`);
        filter.setAttribute("filterUnits", "userSpaceOnUse");
        filter.setAttribute("color-interpolation-filters", "sRGB");
        defs.appendChild(filter);
        live.set(el, filter);
      }
      filter.setAttribute("x", "0");
      filter.setAttribute("y", "0");
      filter.setAttribute("width", String(w));
      filter.setAttribute("height", String(h));
      filter.innerHTML =
        `<feImage x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="none" href="${href}" result="map"/>` +
        ["R", "G", "B"]
          .map(
            (c, i) =>
              `<feDisplacementMap in="SourceGraphic" in2="map" scale="${(o.strength * ABERRATION[i]).toFixed(1)}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/>` +
              `<feColorMatrix in="d${c}" values="${CHANNELS[i]}" result="c${c}"/>`,
          )
          .join("") +
        `<feBlend in="cR" in2="cG" mode="screen" result="rg"/><feBlend in="rg" in2="cB" mode="screen"/>`;

      // Blur first, then refract, then lift: same order as the reference port.
      el.style.backdropFilter = `blur(${o.blur}px) url(#${filter.getAttribute("id")}) saturate(1.7) brightness(1.04)`;
      // The specular rim is a ::before, which needs a containing block. Only
      // promote a statically-positioned surface; fixed/absolute/sticky stay put.
      if (getComputedStyle(el).position === "static") el.style.position = "relative";
      el.classList.add("lg-on");
    };

    // Refraction only exists where the surface is on screen.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const el = e.target as HTMLElement;
          if (e.isIntersecting) build(el);
          else release(el);
        }
      },
      { rootMargin: "120px" },
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = new Set<HTMLElement>();
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) pending.add(e.target as HTMLElement);
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending.forEach((el) => live.has(el) && build(el));
        pending.clear();
      }, 120);
    });

    const track = (el: HTMLElement) => {
      if (known.has(el)) return;
      known.add(el);
      io.observe(el);
      ro.observe(el);
    };
    const untrack = (el: HTMLElement) => {
      if (!known.delete(el)) return;
      io.unobserve(el);
      ro.unobserve(el);
      release(el);
    };
    const scan = (root: ParentNode) => {
      if (root instanceof HTMLElement && root.matches(SELECTOR)) track(root);
      root.querySelectorAll<HTMLElement>(SELECTOR).forEach(track);
    };
    const sweep = () => known.forEach((el) => !el.isConnected && untrack(el));

    scan(document);
    const mo = new MutationObserver((records) => {
      for (const r of records) r.addedNodes.forEach((n) => n instanceof HTMLElement && scan(n));
      if (records.some((r) => r.removedNodes.length)) sweep();
    });
    mo.observe(document.body, { childList: true, subtree: true });

    // Specular rim follows the pointer on the surface it is over.
    let raf = 0;
    let last: PointerEvent | null = null;
    const onMove = (e: PointerEvent) => {
      last = e;
      if (raf || motion.matches) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = (last?.target as Element | null)?.closest<HTMLElement>(".lg-on");
        if (!el || !last) return;
        const r = el.getBoundingClientRect();
        el.style.setProperty("--lg-x", `${(((last.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
        el.style.setProperty("--lg-y", `${(((last.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
      });
    };
    addEventListener("pointermove", onMove, { passive: true });

    // User flips reduced-transparency mid-session: drop every filter at once.
    const onTransparency = () => {
      if (transparency.matches) [...live.keys()].forEach(release);
      else known.forEach(build);
    };
    transparency.addEventListener("change", onTransparency);

    return () => {
      mo.disconnect();
      io.disconnect();
      ro.disconnect();
      clearTimeout(timer);
      cancelAnimationFrame(raf);
      removeEventListener("pointermove", onMove);
      transparency.removeEventListener("change", onTransparency);
      known.forEach(release);
      svg.remove();
    };
  }, []);

  return null;
}
