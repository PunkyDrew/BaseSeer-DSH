// css-tree 3.2.1 exports pure ESM entrypoints; @types/css-tree 3.2.0
// declares these APIs only at the root.
declare module "css-tree/parser" {
  const parse: typeof import("css-tree").parse;
  export default parse;
}
declare module "css-tree/walker" {
  const walk: typeof import("css-tree").walk;
  export default walk;
}
declare module "css-tree/tokenizer" {
  export { tokenize, tokenNames } from "css-tree";
}
declare module "css-tree/utils" {
  export { ident } from "css-tree";
}
