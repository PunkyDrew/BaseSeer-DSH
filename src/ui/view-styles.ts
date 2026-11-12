// The tab is a conversation view of DSH's panel. With the composer-overlay
// attribute the host gives it the panel's full height and floats the chat box
// over its bottom, publishing the box's height as --dsh-composer-height; the
// view keeps that strip clear and scrolls its own regions. Layout breakpoints
// are container queries on the view's own width, since the panel can be a
// narrow side pane on a wide screen.
//
// The chrome is quiet: paper (graphite in the dark theme), hairline rules and
// Barlow lettering, so the colour in the pictures and on the list's kind marks
// is the colour that means something. Blue is for links and keyboard focus,
// red for what failed.
import { tones, wash } from "./graph-presentation.ts";

const toneVars = (theme: "light" | "dark") =>
  Object.entries(tones)
    .map(([key, tone]) => `--tone-${key}:${tone[theme]};`)
    .join(" ");
export const viewStyles = `
.bpv { --paper:#ffffff; --paper-2:#f3f4f5; --ink:#16191c; --ink-2:#4b545c; --ink-3:#69737b; --hair:#d3d8db; --hair-2:#959ea5; --blue:#1d5bbf; --blue-wash:#e7eefa; --red:#b42318; --lettering:"Barlow",system-ui,sans-serif; --mono:ui-monospace,"Cascadia Mono",Consolas,monospace; ${toneVars("light")} --wash:${wash.light}; }
[data-ds-dark-theme] .bpv { --paper:#141619; --paper-2:#1b1e22; --ink:#e7eaec; --ink-2:#aeb6bd; --ink-3:#8f98a0; --hair:#30363c; --hair-2:#56606a; --blue:#86b0f2; --blue-wash:#1c2a42; --red:#f27b6f; ${toneVars("dark")} --wash:${wash.dark}; }
.bpv { box-sizing:border-box; container:workspace / inline-size; display:flex; flex-direction:column; width:100%; height:100%; min-height:0; min-width:0; overflow:hidden; padding:0 0 calc(var(--dsh-composer-height, 152px) + 8px); background:var(--paper); color:var(--ink); font:400 14px/1.5 var(--lettering); scrollbar-color:var(--hair-2) var(--paper); caret-color:var(--blue); }
.bpv * { box-sizing:border-box; }
.bpv h1 { font-size:20px; line-height:1.25; font-weight:600; margin:0; letter-spacing:-.005em; }
.bpv h2 { font-size:18px; line-height:1.3; margin:0 0 10px; font-weight:600; }
.bpv h3 { font-size:15px; line-height:1.35; margin:18px 0 6px; font-weight:600; }
.bpv h4 { font-size:13px; line-height:1.4; margin:14px 0 4px; font-weight:600; color:var(--ink-2); }
.bpv p { margin:6px 0; max-width:70ch; white-space:pre-wrap; overflow-wrap:anywhere; }
.bpv ul,.bpv ol { padding-left:20px; margin:8px 0 14px; }
.bpv li { margin:4px 0; overflow-wrap:anywhere; }
.bpv li::marker { color:var(--ink-3); }
.bpv code { font:12px/1.45 var(--mono); overflow-wrap:anywhere; }
.bpv pre.bpc-source { white-space:pre-wrap; overflow-wrap:anywhere; max-height:360px; overflow:auto; padding:12px; border:1px solid var(--hair-2); background:var(--paper); font:13px/1.6 var(--mono); }
.bpv button { font:500 14px/1.3 var(--lettering); color:var(--ink); border:1px solid var(--hair-2); background:var(--paper); border-radius:0; padding:6px 12px; cursor:pointer; min-height:36px; transition:background-color .15s ease-out,color .15s ease-out; }
.bpv button:hover { background:var(--paper-2); }
.bpv button:active { background:var(--hair); }
.bpv button:disabled { color:var(--ink-3); border-color:var(--hair-2); background:var(--paper); cursor:default; }
.bpv button[aria-pressed=true] { background:var(--ink); border-color:var(--ink); color:var(--paper); }
.bpv button.bpv-primary { background:var(--ink); border-color:var(--ink); color:var(--paper); font-weight:600; }
.bpv button.bpv-primary:hover { background:var(--ink-2); border-color:var(--ink-2); }
.bpv select,.bpv input:not([type=checkbox]):not([type=radio]),.bpv textarea { font:400 14px/1.3 var(--lettering); color:var(--ink); background:var(--paper); border:1px solid var(--hair-2); border-radius:0; min-height:36px; padding:6px 8px; max-width:100%; }
.bpv select:hover,.bpv input:not([type=checkbox]):not([type=radio]):hover { border-color:var(--ink); }
.bpv input::placeholder,.bpv textarea::placeholder { color:var(--ink-3); }
.bpv select option { color:#16191c; background:#fff; }
.bpv input[type=checkbox],.bpv input[type=radio] { accent-color:var(--ink); }
.bpv :focus-visible { outline:2px solid var(--blue); outline-offset:2px; }
.bpv ::selection { background:var(--blue-wash); color:var(--ink); }
.bpv a { color:var(--blue); text-underline-offset:3px; }
.bpv .bpv-link { font:inherit; border:0; border-radius:0; background:transparent; color:var(--blue); padding:2px 0; min-height:unset; text-align:left; text-decoration:underline; text-decoration-thickness:1px; text-underline-offset:3px; }
.bpv .bpv-link:hover { background:transparent; text-decoration-thickness:2px; }
.bpv .bpv-muted { color:var(--ink-2); font-size:13px; }
.bpv .bpv-report { white-space:pre-wrap; overflow-wrap:anywhere; font-size:13px; line-height:1.55; max-height:24em; overflow:auto; }
.bpv label.bpv-toggle { display:flex; align-items:center; gap:8px; min-height:36px; cursor:pointer; }
.bpv-toggle input { width:18px; height:18px; flex:none; }
.bpv-error { padding:8px 12px; border:1px solid var(--red); color:var(--red); background:var(--paper); }
.bpv-notice { flex:none; margin:8px 20px 0; }
.bpv-notice[role=status]:empty { display:none; }
.bpv table { border-collapse:collapse; font-variant-numeric:tabular-nums; }
.bpv td,.bpv th { text-align:left; padding:6px 8px; border-bottom:1px solid var(--hair); vertical-align:top; }
.bpv th { font-weight:600; font-size:13px; color:var(--ink-2); border-bottom:1px solid var(--hair-2); }
.bpv details>summary { cursor:pointer; }
.bpv details>summary::marker { color:var(--ink-3); }

/* Header: the plan's title, its pages, and the way back to chat. */
.bpv-top { flex:none; display:flex; align-items:flex-end; gap:8px 20px; padding:10px 20px 0; border-bottom:1px solid var(--hair-2); }
.bpv-title { display:flex; align-items:baseline; gap:10px; min-width:0; flex:1 1 auto; padding-bottom:10px; }
.bpv-title h1 { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bpv-title .bpv-muted { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bpv-tabs { display:flex; gap:2px; margin-bottom:-1px; overflow-x:auto; scrollbar-width:none; }
.bpv-tabs::-webkit-scrollbar { display:none; }
.bpv .bpv-tabs button { border:0; background:transparent; padding:8px 12px 10px; min-height:40px; color:var(--ink-2); border-bottom:2px solid transparent; white-space:nowrap; font-weight:500; }
.bpv .bpv-tabs button:hover { background:transparent; color:var(--ink); }
.bpv .bpv-tabs button[aria-selected=true] { color:var(--ink); border-color:var(--ink); font-weight:600; }
.bpv-top>.bpv-chat,.bpv-top>.bpv-expand { flex:none; margin-bottom:8px; }

/* Pages keep their scroll position while another is shown. A hidden page also
   takes opacity, since a graph's measured nodes set visibility:visible inline. */
.bpv-panels { flex:1; min-height:0; position:relative; }
.bpv-panel { position:absolute; inset:0; overflow:auto; overscroll-behavior:contain; scrollbar-gutter:stable; container:panel / size; }
.bpv-panel[data-active=false] { visibility:hidden; opacity:0; pointer-events:none; }
.bpv-page { padding:16px 20px 24px; }
.bpv-page>h2:first-child { margin-top:4px; }
.bpv-loading { padding:24px 20px; color:var(--ink-2); }
.bpv-empty { max-width:60ch; padding:32px 20px; }
.bpv-group { padding:8px 0 16px; max-width:820px; }
.bpv-entry { padding:0 0 14px; margin:0 0 14px; border-bottom:1px solid var(--hair); }
.bpv-actions,.bpv-work-actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px; margin:14px 0; }
.bpv-flow { padding-left:26px; }
.bpv-flow>li { padding:8px 0 12px 8px; border-bottom:1px solid var(--hair); }
.bpv-flow>li::marker { color:var(--ink-3); font-variant-numeric:tabular-nums; }
.bpv-history { padding-left:22px; }
.bpv-history>li { padding:0 0 14px 6px; margin-bottom:12px; border-bottom:1px solid var(--hair); }
.bpv-diagram-fold { margin:0 0 18px; border-top:1px solid var(--hair-2); border-bottom:1px solid var(--hair); }
.bpv-diagram-fold>summary { min-height:40px; padding:9px 0; font-weight:600; }
.bpv-diagram-fold>.bpg { height:min(70cqh,560px); margin-bottom:12px; }
.bpv-source-view { padding:16px 0; margin-bottom:16px; border-bottom:1px solid var(--hair); min-width:0; }
.bpv-source-view h2 { overflow-wrap:anywhere; scroll-margin-top:20px; }
.bpv-source-view>button { margin:10px 0; }
.bpv-source-view pre.bpc-source { max-height:min(50vh,480px); }
.bpv-source-view [data-line] { display:block; white-space:pre-wrap; overflow-wrap:anywhere; }
.bpv-source-view [data-mapped] { background:var(--blue-wash); }

/* The build page's settings and usage. */
.bpv-build { padding-bottom:14px; margin-bottom:14px; border-bottom:1px solid var(--hair); }
.bpv-build-order li { margin:4px 0; }
.bpv-build-run { padding:12px 0; border-top:1px solid var(--hair-2); border-bottom:1px solid var(--hair); }
.bpv-build-run h3 { margin:0 0 4px; }
.bpv-work-settings { margin:14px 0; }
.bpv-work-settings>summary,.bpv-page summary { min-height:36px; padding:6px 0; }
.bpv-scroll { overflow:auto; }
.bpv-model-settings { margin:8px 0 20px; }
.bpv-strategy-presets { border:0; padding:0; margin:12px 0; min-width:0; display:grid; gap:0; }
.bpv-strategy-presets legend { font-weight:600; margin-bottom:8px; padding:0; }
.bpv-strategy-card { display:flex; align-items:flex-start; gap:12px; min-height:44px; padding:12px 4px; border-top:1px solid var(--hair); cursor:pointer; overflow-wrap:anywhere; }
.bpv-strategy-card:last-of-type { border-bottom:1px solid var(--hair); }
.bpv-strategy-card:has(input:checked) { border-top:2px solid var(--ink); }
.bpv-strategy-card:has(input:checked)>span>strong { color:var(--ink); }
.bpv-strategy-card:has(input:focus-visible) { outline:2px solid var(--blue); outline-offset:2px; }
.bpv-strategy-card input { margin:3px 0 0; flex-shrink:0; }
.bpv-strategy-card>span { min-width:0; }
.bpv-strategy-card small { display:inline-block; margin-left:8px; font-size:12px; color:var(--ink-2); }
.bpv-strategy-card .bpv-muted { display:block; margin-top:4px; line-height:1.45; }
.bpv-setting-field { display:flex; flex-direction:column; gap:6px; margin:10px 0; min-width:0; flex:1 1 200px; }
.bpv-setting-field select,.bpv-setting-field input { width:100%; }
.bpv-setting-toggle { display:flex; align-items:center; gap:10px; min-height:40px; cursor:pointer; }
.bpv-setting-toggle input { width:20px; height:20px; flex:none; }
.bpv-settings-group { min-width:0; border:0; border-top:1px solid var(--hair-2); margin:10px 0 16px; padding:8px 0 4px; }
.bpv-settings-group legend { padding:0 8px 0 0; font-weight:600; }
.bpv-provider-preference { display:flex; flex-wrap:wrap; gap:12px; }
.bpv-coverage-list { list-style:none; padding-left:0; }
.bpv-coverage-list li { margin:4px 0; }

/* The plan page: the index of views, the picture, and beside it the parts list or one item. */
.bpv-plan { display:grid; grid-template-columns:minmax(0,1fr) clamp(300px,30cqw,380px); grid-template-rows:auto minmax(0,1fr); height:100%; min-height:0; }
.bpv-plan-bar { grid-column:1; display:flex; flex-wrap:wrap; align-items:center; gap:8px 14px; padding:10px 16px 8px 20px; }
.bpv-plan-bar>.bpv-plan-spacer { flex:1; }
.bpv-plan-canvas { grid-column:1; min-height:0; margin:0 0 12px 20px; }
.bpv-plan-canvas>.bpg { height:100%; }
.bpv-side { grid-column:2; grid-row:1 / 3; min-height:0; overflow:auto; overscroll-behavior:contain; border-left:1px solid var(--hair-2); padding:12px 20px 20px 16px; background:var(--paper); }
.bpv-views { display:flex; flex-wrap:wrap; gap:8px 16px; }
.bpv-views-family { display:inline-flex; align-items:center; gap:8px; }
.bpv-views-family>span { font-size:13px; color:var(--ink-2); font-weight:500; }
.bpv-segments { display:inline-flex; }
.bpv .bpv-segments button { margin-left:-1px; padding:4px 11px; min-height:32px; font-size:13px; }
.bpv .bpv-segments button:first-child { margin-left:0; }
.bpv .bpv-segments button[aria-pressed=true] { position:relative; z-index:1; }
.bpv-field { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:var(--ink-2); min-width:0; }
.bpv-views .bpv-view-select { display:none; }
.bpv-field select { min-height:32px; padding:3px 6px; font-size:13px; max-width:min(40cqw,280px); }
.bpv-plan-bar>button,.bpv-plan-bar .bpv-anchor>button { min-height:32px; padding:4px 11px; font-size:13px; }
.bpv-plan-hint { margin:0; font-size:13px; color:var(--ink-2); }
.bpv-flow-bar { display:flex; flex-wrap:wrap; align-items:center; gap:6px 12px; min-width:0; max-width:100%; }
.bpv-flow-bar>.bpv-field { flex:1 1 220px; max-width:100%; }
.bpv .bpv-flow-bar>.bpv-field select { flex:1; min-width:0; width:100%; max-width:min(60cqw,360px); }
.bpv-flow-part { display:inline-flex; flex-wrap:wrap; align-items:center; gap:4px 8px; font-size:13px; color:var(--ink-2); }
.bpv-flow-part strong { color:var(--ink); font-weight:600; }
.bpv-flow-part>button { min-height:28px; padding:2px 10px; font-size:13px; }
.bpv-pop { position:absolute; z-index:30; top:calc(100% + 4px); right:0; width:min(360px,calc(100cqw - 40px)); padding:12px 14px; border:1px solid var(--hair-2); background:var(--paper); color:var(--ink); font-size:13px; }
.bpv-pop p { font-size:13px; margin:8px 0 0; }
.bpv-pop fieldset { border:0; margin:8px 0 0; padding:0; min-width:0; }
.bpv-pop legend { padding:0; font-weight:600; }
.bpv-anchor { position:relative; }

/* A part's facts as a ruled key list, and its files. */
.bpv-facts { margin:8px 0 4px; border-top:1px solid var(--hair); }
.bpv-facts>div { display:grid; grid-template-columns:7.5em minmax(0,1fr); align-items:baseline; gap:0 12px; padding:6px 0; border-bottom:1px solid var(--hair); }
.bpv-facts dt { font-size:13px; font-weight:600; color:var(--ink-2); }
.bpv-facts dd { margin:0; overflow-wrap:anywhere; }
.bpv ul.bpv-files { list-style:none; padding:0; margin:4px 0 12px; }
.bpv ul.bpv-files>li { margin:0; padding:4px 0; border-bottom:1px solid var(--hair); font:12.5px/1.45 var(--mono); }

/* The side column: the plan's items as a parts list, and one item's details. */
.bpv-items input { width:100%; margin-bottom:10px; }
.bpv-items details { border-top:1px solid var(--hair-2); }
.bpv-items details:last-of-type { border-bottom:1px solid var(--hair); }
.bpv-items summary { min-height:40px; padding:9px 0; font-weight:600; display:flex; align-items:center; gap:8px; }
.bpv-items summary>.bpv-muted { font-weight:400; font-variant-numeric:tabular-nums; }
.bpv-kind { flex:none; width:11px; height:11px; border:2px solid var(--k); background:color-mix(in srgb,var(--k) var(--wash),var(--paper)); }
.bpv-items ul { list-style:none; margin:0 0 8px; padding:0; }
.bpv-items li { margin:0; border-top:1px solid var(--hair); }
.bpv .bpv-items li>button { display:flex; flex-direction:column; align-items:flex-start; gap:2px; width:100%; text-align:left; border:0; background:transparent; padding:8px 6px; min-height:36px; font-weight:500; line-height:1.35; }
.bpv .bpv-items li>button:hover { background:var(--paper-2); }
.bpv .bpv-items li>button[aria-current=true] { background:var(--paper); color:var(--ink); font-weight:600; outline:1.5px solid var(--ink); outline-offset:-1.5px; }
.bpv-items li>button>span { font-size:12.5px; line-height:1.45; font-weight:400; color:var(--ink-2); overflow-wrap:anywhere; }
.bpv-items-empty { padding:16px 0; }
/* The plan's history, folded under its items. */
.bpv-history-fold { margin-top:-1px; border-top:1px solid var(--hair-2); }
.bpv-history-fold>summary { min-height:40px; padding:9px 0; font-weight:600; display:flex; align-items:center; gap:8px; }
.bpv-history-fold>summary>.bpv-muted { font-weight:400; font-variant-numeric:tabular-nums; }
.bpv-history-fold .bpv-group { padding:0 0 8px; max-width:none; }
.bpv-history-fold h2 { font-size:15px; margin:12px 0 6px; }
.bpv-detail { overflow-wrap:anywhere; }
.bpv-detail-bar { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:8px; position:sticky; top:-12px; z-index:2; background:var(--paper); padding:8px 0; border-bottom:1px solid var(--hair); }
.bpv-detail h2 { margin:6px 0 4px; font-size:20px; }
.bpv .bpv-back { display:inline-flex; align-items:center; gap:6px; }
.bpv-detail h3 { margin-top:20px; padding-top:8px; border-top:1px solid var(--hair-2); }
.bpv-detail h4 { color:var(--ink-2); }
.bpv-detail details { margin:8px 0; }
.bpv-detail summary { min-height:36px; padding:6px 0; }
.bpg-impact { margin:12px 0; font-size:14px; line-height:1.5; overflow-wrap:anywhere; }
.bpg-impact h3 { margin:20px 0 6px; }
.bpg-impact-items { list-style:none; margin:10px 0; padding:0; }
.bpg-impact-items>li { border-top:1px solid var(--hair); padding:8px 0; }

@container workspace (max-width: 899px) {
  .bpv-plan { display:flex; flex-direction:column; height:auto; }
  .bpv-plan-canvas { margin:0 16px 12px; height:clamp(320px,64cqh,660px); flex:none; }
  .bpv-side { border-left:0; border-top:1px solid var(--hair-2); padding:12px 16px 20px; overflow:visible; }
  .bpv-side[data-sheet] { position:sticky; bottom:0; z-index:20; max-height:min(32cqh,300px); overflow:auto; border-top:1px solid var(--hair-2); background:var(--paper); box-shadow:0 -6px 18px #0f141926; }
  .bpv-plan-bar { padding:8px 16px 6px; }
}
@container workspace (max-width: 639px) {
  .bpv-top { flex-wrap:wrap; gap:0 12px; padding:8px 12px 0; }
  .bpv-title { flex-basis:0; padding-bottom:6px; }
  .bpv-tabs { order:3; flex-basis:100%; }
  .bpv-top>.bpv-chat,.bpv-top>.bpv-expand { margin-bottom:6px; }
  .bpv-page { padding:12px 12px 20px; }
  .bpv-notice { margin:8px 12px 0; }
  .bpv-views-family { display:none; }
  .bpv-views .bpv-view-select { display:inline-flex; }
  .bpv-plan-bar { padding:8px 12px 6px; }
  .bpv-flow-bar { flex-basis:100%; flex-wrap:nowrap; }
  .bpv-flow-part { flex:none; flex-wrap:nowrap; }
  .bpv-flow-part>span { max-width:30cqw; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bpv-flow-prefix,.bpv-flow-bar>.bpv-field>span { position:absolute; width:1px; height:1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
  .bpv .bpv-flow-bar>.bpv-field select { max-width:100%; }
  .bpv-plan-canvas { margin:0 12px 12px; }
  .bpv-side { padding:12px 12px 20px; }
  .bpv-pop { right:auto; left:0; }
}
@media(prefers-reduced-motion:reduce) { .bpv *,.bpv *::before,.bpv *::after { scroll-behavior:auto!important; animation:none!important; transition:none!important; } }
`;
