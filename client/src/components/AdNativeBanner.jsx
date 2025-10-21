import React, { useEffect, useRef, useState } from "react";

const AdNativeBanner = ({ style, onAdLoaded, onAdBlocked, timeoutMs = 2500 }) => {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const adDivId = "container-f09c12203dde3fa0d106e0b23285290c";
    let adDiv = containerRef.current || document.getElementById(adDivId);
    if (!adDiv) {
      adDiv = document.createElement("div");
      adDiv.id = adDivId;
      // If containerRef.current exists, append inside it; otherwise append to body
      if (containerRef.current) containerRef.current.appendChild(adDiv);
      else document.body.appendChild(adDiv);
    }
    // Clear previous contents
    adDiv.innerHTML = "";

    let didLoad = false;
    const script = document.createElement("script");
    script.async = true;
    script.setAttribute("data-cfasync", "false");
    script.src = "//pl27859430.effectivegatecpm.com/f09c12203dde3fa0d106e0b23285290c/invoke.js";

    // Ad networks may block requests (403) — detect load/failure and hide container on failure
    script.onload = () => {
      didLoad = true;
      // Give the network a short moment to render content. If nothing appears, collapse after timeout.
      setTimeout(() => {
        const hasChild = adDiv && adDiv.children && adDiv.children.length > 0;
        if (!hasChild) {
          setVisible(false);
          if (typeof onAdBlocked === 'function') onAdBlocked();
          return;
        }

        // Heuristic metadata extraction (best-effort). Many providers inject iframes (cross-origin) which
        // we cannot introspect. But if the provider injects plain DOM nodes in the same document we can
        // attempt to pull title, subtitle, link and image.
        let metadata = null;
        try {
          // If the first child is an iframe, try to at least capture the iframe src (may be useful)
          const iframe = adDiv.querySelector('iframe');
          if (iframe) {
            // We cannot access cross-origin iframe contents, but we can expose the iframe.src if present.
            metadata = { clickUrl: iframe.src || null };
          } else {
            // Look for obvious elements inside the injected creative
            const anchor = adDiv.querySelector('a[href]');
            const titleEl = adDiv.querySelector('h1, h2, h3, .ad-title');
            const subtitleEl = adDiv.querySelector('p, .ad-subtitle, .ad-description');
            const img = adDiv.querySelector('img');
            const title = titleEl ? (titleEl.textContent || null) : null;
            const subtitle = subtitleEl ? (subtitleEl.textContent || null) : null;
            const clickUrl = anchor ? anchor.getAttribute('href') : null;
            const image = img ? (img.getAttribute('src') || null) : null;
            if (title || subtitle || clickUrl || image) {
              metadata = { title, subtitle, clickUrl, image };
            }
          }
        } catch {
          // If any DOM access throws, treat as no metadata available
          metadata = null;
        }

        if (typeof onAdLoaded === 'function') {
          try { onAdLoaded(metadata); } catch (e) { console.warn('[AdNativeBanner] onAdLoaded callback error', e); }
        }
      }, 1000);
    };
    script.onerror = (e) => {
      console.warn('[AdNativeBanner] Ad script failed to load or was blocked:', e);
      setVisible(false);
      if (typeof onAdBlocked === 'function') onAdBlocked(e);
    };

    // Fallback timeout: if script doesn't call onload within 2.5s, assume blocked and hide
    const timeoutId = setTimeout(() => {
      if (!didLoad) {
        console.warn('[AdNativeBanner] Ad script timed out; hiding native ad container.');
        setVisible(false);
        if (typeof onAdBlocked === 'function') onAdBlocked(new Error('ad-script-timeout'));
      }
    }, timeoutMs);

  adDiv.appendChild(script);

    return () => {
      clearTimeout(timeoutId);
      if (adDiv) adDiv.innerHTML = "";
    };
  }, [onAdLoaded, onAdBlocked, timeoutMs]);

  if (!visible) return null;
  return <div ref={containerRef} id="container-f09c12203dde3fa0d106e0b23285290c" style={style} />;
};

export default AdNativeBanner;
