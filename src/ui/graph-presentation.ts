import type { Document } from "../domain/records.ts";

// Paired theme colors. Each kind of thing has one hue, the same in every
// picture and in the items list, as C4 colours its element types: a box
// carries it as its outline and the wash inside, and its kind line is
// lettered in it. Shape, outline, dash and label tell the kind too, so colour
// never stands alone; red marks only what contradicts or failed.
export const tones = {
  ink: { light: "#4b545c", dark: "#aeb6bd" },
  grey: { light: "#69737b", dark: "#8f98a0" },
  blue: { light: "#1d5bbf", dark: "#86b0f2" },
  navy: { light: "#3730a3", dark: "#a5b4fc" },
  teal: { light: "#0d6660", dark: "#5ccfc0" },
  green: { light: "#166534", dark: "#7ed69b" },
  amber: { light: "#9a4608", dark: "#f3c35a" },
  purple: { light: "#7e22ce", dark: "#c9a3f5" },
  rose: { light: "#be123c", dark: "#f4a0bd" },
  red: { light: "#b42318", dark: "#f27b6f" },
} as const;
/** How much of its hue a washed box carries over each theme's paper; a grey box stays paper. */
export const wash = { light: "12%", dark: "10%" } as const;
export type Tone = keyof typeof tones;
export const nodeTones: Record<string, Tone> = {
  component: "blue",
  interface: "teal",
  requirement: "green",
  decision: "amber",
  task: "ink",
  finding: "red",
  question: "purple",
  evidence: "grey",
  mapping: "grey",
};
export const relationships: Record<
  string,
  { label: string; tone: Tone; dash?: string }
> = {
  uses: { label: "Uses", tone: "ink" },
  "depends-on": { label: "Needs first", tone: "ink" },
  implements: { label: "Implements contract", tone: "ink", dash: "8 4" },
  satisfies: { label: "Fulfills requirement", tone: "ink", dash: "2 5" },
  addresses: { label: "Addresses", tone: "ink", dash: "10 4 2 4" },
  "maps-to": { label: "Source link", tone: "ink", dash: "10 5" },
  supports: { label: "Supports", tone: "ink" },
  contradicts: { label: "Contradicts", tone: "red", dash: "3 3" },
  value: { label: "Import", tone: "ink" },
  type: { label: "Type import", tone: "ink", dash: "8 4" },
  dynamic: { label: "Dynamic import", tone: "ink", dash: "2 5" },
};
export const nodeColor = (kind: string) =>
  `var(--tone-${nodeTones[kind.toLowerCase()] ?? "ink"})`;
// A flow's lanes and lifelines take one hue per part, chosen from the part's
// own id, so a part keeps its hue from Flows to Sequence and from one plan
// revision to the next.
const laneTones: Tone[] = ["blue", "teal", "amber", "purple", "green", "rose", "navy"];
export function partColor(doc: Document, part: string) {
  if (!doc.records.some((r) => r.id === part && r.kind === "component")) return "var(--tone-ink)";
  let hash = 0;
  for (const c of part) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `var(--tone-${laneTones[hash % laneTones.length]})`;
}
export const edgePresentation = (type: string) => {
  const value = relationships[type] ?? {
    label: type.replaceAll("-", " "),
    tone: "ink",
  };
  return { ...value, color: `var(--tone-${value.tone})` };
};
