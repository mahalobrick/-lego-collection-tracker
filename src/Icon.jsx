// Heritage Luxe icon. Inlines the matching 24×24 currentColor line-icon from
// src/icons/ui/ so it inherits the surrounding token text color (active = --bk-action,
// inactive = --bk-text-muted). No hardcoded size or color — color rides `currentColor`,
// size is injected from the prop. Vite's import.meta.glob(?raw) pulls every icon in as a
// build-time string, so dropping a new SVG into src/icons/ui/ registers it automatically.

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
export default function Icon({ name, size = 20, title, style, className }) {
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
