// Heritage Luxe icon. Inlines the matching 24×24 currentColor line-icon from
// src/icons/ui/ so it inherits the surrounding token text color (active = --bk-action,
// inactive = --bk-text-muted). No hardcoded size or color — color rides `currentColor`,
// size is injected from the prop. Vite's import.meta.glob(?raw) pulls every icon in as a
// build-time string, so dropping a new SVG into src/icons/ui/ registers it automatically.

import { memo } from "react";

const RAW = import.meta.glob("./icons/ui/*.svg", { query: "?raw", eager: true, import: "default" });

const ICONS = Object.fromEntries(
  Object.entries(RAW).map(([path, raw]) => [path.split("/").pop().replace(".svg", ""), raw])
);

export const ICON_NAMES = Object.keys(ICONS);

/**
 * Decorative by default (aria-hidden). Pass `title` when the icon is the sole content of a
 * control so it gets an accessible name.
 *
 * @param {{ name: string, size?: number, title?: string, style?: object, className?: string }} props
 */
function Icon({ name, size = 20, title, style, className }) {
  const raw = ICONS[name];
  if (!raw) {
    if (import.meta.env?.DEV) console.warn(`<Icon>: unknown name "${name}"`);
    return null;
  }
  // Assets ship viewBox-only; inject the requested pixel size. currentColor handles theming.
  const html = raw.replace("<svg ", `<svg width="${size}" height="${size}" `);
  return (
    <span
      className={className}
      role={title ? "img" : undefined}
      aria-label={title || undefined}
      aria-hidden={title ? undefined : true}
      style={{ display: "inline-flex", lineHeight: 0, flexShrink: 0, ...style }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// Memoized so the parent's per-mousemove re-render storm (MyCollection setTipPos) can't re-invoke
// Icon and re-inject its dangerouslySetInnerHTML <svg> — that node swap was breaking a cold click
// whose mousedown/mouseup straddled a re-render (see the cold-click-race diagnosis). Props are stable
// primitives (name/size) at the row-action call sites, so memo skips those churn renders entirely;
// a genuine name/size change still re-renders (shallow prop compare). Color rides currentColor (CSS),
// so theming never needs an Icon re-render.
export default memo(Icon);
