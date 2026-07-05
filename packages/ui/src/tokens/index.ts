export const brand = {
  name: "LeadVirt.ai",
  colors: {
    zinc950: "#09090b",
    emerald400: "#34d399",
    teal400: "#2dd4bf",
    sky400: "#38bdf8",
    violet400: "#a78bfa",
    amber400: "#fbbf24",
    rose400: "#fb7185"
  }
} as const;

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}
