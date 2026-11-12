import regular from "@fontsource/barlow/files/barlow-latin-400-normal.woff2";
import medium from "@fontsource/barlow/files/barlow-latin-500-normal.woff2";
import semibold from "@fontsource/barlow/files/barlow-latin-600-normal.woff2";

// The tab's lettering: Barlow, a grotesque in the line of DIN and technical
// lettering, inlined so the plugin needs no font host.
export const sheetFonts = (
  [
    [400, regular],
    [500, medium],
    [600, semibold],
  ] as const
)
  .map(
    ([weight, url]) =>
      `@font-face{font-family:"Barlow";font-style:normal;font-weight:${weight};font-display:swap;src:url(${url}) format("woff2");}`,
  )
  .join("");
