"use client";

import { useEffect, useRef, useState } from "react";

const EMAIL_WIDTH = 600; // hard-coded in all email component inline styles

/**
 * Scales a 600px-wide email HTML document to fill the available container
 * width on both desktop and mobile. The iframe keeps its native 600px
 * content; a CSS transform zooms it to fit, so the email renders pixel-
 * perfect at any viewport size.
 */
export function EmailPreviewFrame({ srcDoc }: { srcDoc: string }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(1);
  const [iframeHeight, setIframeHeight] = useState(1000);

  // Re-compute scale whenever the wrapper resizes (handles resize + orientation change)
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      setScale(w > 0 ? Math.min(1, w / EMAIL_WIDTH) : 1);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Auto-size the iframe height after the email HTML loads
  function handleLoad() {
    try {
      const doc = iframeRef.current?.contentWindow?.document;
      if (!doc) return;
      const h = doc.documentElement.scrollHeight || doc.body.scrollHeight;
      if (h > 0) setIframeHeight(h);
    } catch {
      // cross-origin guard — won't happen with srcDoc but be safe
    }
  }

  return (
    // Wrapper div sets the layout footprint; height = scaled iframe height
    <div
      ref={wrapperRef}
      className="w-full overflow-hidden rounded-lg border border-black/10"
      style={{ height: iframeHeight * scale }}
    >
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Email preview"
        onLoad={handleLoad}
        style={{
          width: EMAIL_WIDTH,
          height: iframeHeight,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          border: "none",
          display: "block",
        }}
      />
    </div>
  );
}
