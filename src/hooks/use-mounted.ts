"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while the server renders and during hydration, true afterwards.
 *
 * For content whose structure depends on the viewer's clock or time zone (which "day" an item falls in). The server cannot know
 * the viewer's day, so rendering that structure on the server hands the browser markup it then disagrees with (React #418). A
 * plain `useState` + `useEffect` flag trips the react-hooks lint rule; this is the sanctioned form.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
