"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Reset mobile pinch-zoom to fit-width on every in-app (client-side) navigation.
 *
 * Pinch-zoom is browser-level *visual viewport* state — it belongs to the tab,
 * not to any page or link. A full page load resets it automatically; a client
 * side route change (`<Link>` / `router.push`) does not, so you'd otherwise
 * carry your zoom onto the next page. iOS Safari snaps the zoom back to
 * `initial-scale` the moment `user-scalable=no` is applied, so we toggle the
 * viewport meta off-and-on around each route change to force a reset, then
 * restore it so the user can still pinch-zoom on the new page.
 *
 * Mounted once in the root layout → applies to the whole app. (Map → ZIP clicks
 * already use a full page load, which resets zoom on its own; this covers
 * everything else.)
 */
export function ResetZoomOnRouteChange() {
  const pathname = usePathname();
  const firstRender = useRef(true);

  useEffect(() => {
    // Skip the initial load — a fresh document already opens at fit-width.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const vp = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (!vp) return;

    const restore = vp.getAttribute("content") ?? "width=device-width, initial-scale=1";
    // Clamp to scale 1 + disable scaling: iOS resets the current zoom to 1.
    vp.setAttribute(
      "content",
      "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    );
    // Restore next frame so pinch-zoom is available again on the new page.
    const id = requestAnimationFrame(() => vp.setAttribute("content", restore));
    return () => cancelAnimationFrame(id);
  }, [pathname]);

  return null;
}
