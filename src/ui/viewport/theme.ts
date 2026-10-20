/** Reads design tokens out of CSS so the canvases follow the active theme. */
export type ViewTheme = {
  viewport: string;
  grid: string;
  rib: string;
  spar: string;
  le: string;
  te: string;
  ghost: string;
  fg: string;
  muted: string;
  accent: string;
  border: string;
};

export const read = (name: string, fallback: string) => {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

export function viewTheme(): ViewTheme {
  return {
    viewport: read("--wb-viewport", "#d6dade"),
    grid: read("--wb-viewport-grid", "#b9bfc6"),
    rib: read("--wb-geo-rib", "#e69f00"),
    spar: read("--wb-geo-spar", "#0072b2"),
    le: read("--wb-geo-leading-edge", "#009e73"),
    te: read("--wb-geo-trailing-edge", "#d55e00"),
    ghost: read("--wb-geo-ghost", "#8a929c"),
    fg: read("--wb-fg", "#14171c"),
    muted: read("--wb-muted", "#555d69"),
    accent: read("--wb-accent", "#5a3fc4"),
    border: read("--wb-border", "#d2d7dd"),
  };
}

export function lineTheme(): ViewTheme {
  const t = viewTheme();
  return {
    ...t,
    rib: read("--wb-geoline-rib", "#a66f00"),
    spar: read("--wb-geoline-spar", "#0072b2"),
    le: read("--wb-geoline-leading-edge", "#007a59"),
    te: read("--wb-geoline-trailing-edge", "#b04c00"),
    ghost: read("--wb-geoline-ghost", "#6b7280"),
  };
}
