"use client";

import { useEffect } from "react";
import { EFFECTS_COOKIE, isWeakDevice } from "@/lib/effects";

const MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Decides the visual effects level once for a person who has not chosen one (Task 129 D5).
 *
 * Renders nothing. With no `verity-effects` cookie it checks the device; a weak one gets lite effects now and a remembered
 * `auto-lite`, so the next request is stamped by the server with no flash of blur. A capable device is left alone and is
 * checked again next visit (cheap, and a phone can be replaced). A chosen value is never touched.
 */
export function EffectsDetector() {
  useEffect(() => {
    if (document.cookie.split("; ").some((entry) => entry.startsWith(`${EFFECTS_COOKIE}=`))) return;
    const nav = navigator as Navigator & { deviceMemory?: number };
    if (!isWeakDevice({ hardwareConcurrency: nav.hardwareConcurrency, deviceMemory: nav.deviceMemory })) return;
    document.cookie = `${EFFECTS_COOKIE}=auto-lite; path=/; max-age=${MAX_AGE}; samesite=lax`;
    document.documentElement.setAttribute("data-effects", "lite");
  }, []);
  return null;
}
