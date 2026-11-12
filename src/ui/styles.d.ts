declare module "*.css" {
  const css: string;
  export default css;
}
declare module "*.woff2" {
  /** The font file as a data URL; the client bundle inlines it. */
  const url: string;
  export default url;
}
