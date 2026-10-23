"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icons";
import type { Labels } from "../labels";

type Detector = { detect: (source: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };

/**
 * The scan box: a camera that reads the QR on a slip or a label, and a text box for the number printed under it. A Bluetooth or USB
 * scanner types into the box and presses Enter, so it needs nothing else. The camera uses the browser's own detector where there is
 * one (Android Chrome) and a small decoder elsewhere (iPhone), and stops the moment it reads a code.
 */
export function Scanner({ t, initial }: { t: Labels; initial: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initial);
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    setOn(false);
  }, []);

  const open = useCallback((value: string) => {
    const v = value.trim();
    if (!v) return;
    stop();
    router.push(`/shopfloor/scan?code=${encodeURIComponent(v)}`);
  }, [router, stop]);

  useEffect(() => stop, [stop]);

  const start = async () => {
    setFailed(false);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      stream.current = media;
      setOn(true);
      const el = video.current!;
      el.srcObject = media;
      await el.play();
      const Native = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = Native ? new Native({ formats: ["qr_code"] }) : null;
      const jsQR = native ? null : (await import("jsqr")).default;
      const canvas = document.createElement("canvas");
      const tick = async () => {
        if (!stream.current) return;
        let found: string | null = null;
        if (el.readyState >= 2) {
          if (native) {
            const codes = await native.detect(el).catch(() => []);
            found = codes[0]?.rawValue ?? null;
          } else if (jsQR) {
            const w = el.videoWidth, h = el.videoHeight;
            canvas.width = w; canvas.height = h;
            const ctx = canvas.getContext("2d", { willReadFrequently: true });
            if (ctx && w > 0) {
              ctx.drawImage(el, 0, 0, w, h);
              found = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" })?.data ?? null;
            }
          }
        }
        if (found) open(found);
        else timer.current = window.setTimeout(tick, 220);
      };
      void tick();
    } catch {
      stop();
      setFailed(true);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className={`relative overflow-hidden rounded-[18px] bg-black ${on ? "aspect-[4/3]" : "hidden"}`}>
        <video ref={video} playsInline muted className="size-full object-cover" aria-label={t.scanLooking} />
        {/* A frame to aim with: the QR on a slip fills about a third of it at arm's length. */}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 size-[52%] -translate-x-1/2 -translate-y-1/2 rounded-[22px] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
        <p role="status" className="absolute inset-x-0 bottom-3 m-0 text-center text-[14px] font-medium text-white">{t.scanLooking}</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {on ? (
          <Button type="button" variant="secondary" className="min-h-12 flex-1" onClick={stop}>{t.scanStop}</Button>
        ) : (
          <Button type="button" variant="primary" className="min-h-12 flex-1 gap-2" onClick={start}><Icon name="photo" size={18} />{t.scanCamera}</Button>
        )}
      </div>
      {failed && <p role="alert" className="m-0 text-[14px] text-text-secondary">{t.scanNoCamera}</p>}

      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); open(code); }}>
        <Input aria-label={t.scanType} placeholder={t.scanType} value={code} onChange={(e) => setCode(e.target.value)} autoCapitalize="characters" autoComplete="off" enterKeyHint="go" className="min-h-12 text-[16px]" />
        <Button type="submit" variant="secondary" className="min-h-12 shrink-0" disabled={code.trim() === ""}>{t.scanOpen}</Button>
      </form>
    </div>
  );
}
