/**
 * Shows a `popover="manual"` element in the browser's top layer, so a picker's panel sits above a modal dialog and is neither clipped by
 * the dialog's scrolling body nor re-anchored by its blur filter (a filtered ancestor makes `position: fixed` relative to itself).
 * Used as a ref callback. A browser without the Popover API simply shows the panel in place.
 */
export function showInTopLayer(element: HTMLElement | null): void {
  if (!element || typeof element.showPopover !== "function") return;
  try {
    if (!element.matches(":popover-open")) element.showPopover();
  } catch {
    // Already shown or not connected yet; the panel stays visible in place.
  }
}
