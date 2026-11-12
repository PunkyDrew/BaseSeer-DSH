// Every box carries its kind's hue as its outline and a wash inside; the
// standard notations keep their shapes, and a lane or lifeline takes its
// part's hue. Selection is solid ink, and what it does not touch steps back.
export const graphStyles = `
.bpg { display:flex; flex-direction:column; min-width:0; min-height:0; height:100%; }
.bpg-canvas { position:relative; flex:1; min-height:200px; width:100%; display:flex; flex-direction:column; border:1px solid var(--hair-2); background:var(--paper); overflow:hidden; container:canvas / size; }
.bpg-canvas>.react-flow { flex:1 1 0; min-height:0; height:auto!important; }
.bpg-loading,.bpg-empty { flex:1; display:grid; place-content:center; padding:24px; text-align:center; border:1px dashed var(--hair-2); background:var(--paper); color:var(--ink-2); }
.bpg-empty p { max-width:46ch; margin:0 0 16px; }
.bpg-alert { margin:0; padding:12px; }

/* Parts: each box outlined and washed in its kind's hue, its title leading. */
.bpg-node { --k:var(--tone-ink); box-sizing:border-box; width:224px; min-height:96px; padding:9px 12px 10px; background:color-mix(in srgb,var(--k) var(--wash),var(--paper)); color:var(--ink); border:2px solid var(--k); border-radius:2px; text-align:left; overflow-wrap:anywhere; font-family:var(--lettering); }
.bpg-node[data-kind=component] { --k:var(--tone-blue); }
.bpg-node[data-type=person] { --k:var(--tone-navy); }
.bpg-node[data-kind=interface] { --k:var(--tone-teal); border-style:dashed; }
.bpg-node[data-kind=requirement] { --k:var(--tone-green); }
.bpg-node[data-kind=decision] { --k:var(--tone-amber); }
.bpg-node[data-kind=question] { --k:var(--tone-purple); }
.bpg-node[data-kind=finding] { --k:var(--tone-red); }
.bpg-node[data-type=external-system],.bpg-node[data-kind=mapping],.bpg-node[data-kind=evidence] { --k:var(--tone-grey); background:var(--paper); }
.bpg-node[data-kind=mapping] { border-style:dotted; }
.bpg-node strong { display:block; font-size:14px; line-height:1.25; font-weight:600; white-space:normal; }
.bpg-kind { display:block; margin:3px 0 0; color:var(--k); font-size:12px; line-height:1.35; font-weight:500; }
.bpg-node[data-type=external-system] .bpg-kind,.bpg-node[data-kind=task] .bpg-kind { color:var(--ink-2); }
.bpg-node p { font-size:12.5px; line-height:1.4; margin:6px 0 0; color:var(--ink); white-space:normal; }
.bpg-node .bpg-purpose { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; width:100%; max-width:none!important; }
.bpg-files { font:12px/1.4 var(--mono); margin-top:6px; color:var(--ink-2); }
.bpg-status { display:block; margin-top:8px; padding-top:5px; border-top:1px solid var(--hair); font-size:11px; font-weight:600; letter-spacing:.07em; text-transform:uppercase; color:var(--ink-3); }
.bpg .react-flow__node.selected .bpg-node,.bpg .react-flow__node:focus-visible .bpg-node { outline:2.5px solid var(--ink); outline-offset:2px; }
.bpg .react-flow__node:focus-visible { outline:none; }
.bpg .react-flow__node.bpg-dim { opacity:.32; }
.bpg .react-flow__edge.bpg-dim { opacity:.16; }
.bpg .react-flow__edge.bpg-near .react-flow__edge-path { stroke:var(--ink)!important; stroke-width:2.25!important; }
.bpg .react-flow__handle { opacity:0; pointer-events:none; }
.bpg .react-flow__edge.selected .react-flow__edge-path,.bpg .react-flow__edge:focus-visible .react-flow__edge-path { stroke:var(--ink)!important; stroke-width:2.75!important; }
.bpg .react-flow__edge:focus-visible { outline:none; }
.bpg .bpg-edge-label { position:absolute; box-sizing:border-box; width:max-content; max-width:220px; height:auto; padding:5px 8px; border:1px solid var(--hair-2); border-radius:2px; background:var(--paper); color:var(--ink); font:500 12px/1.35 var(--lettering); white-space:pre-wrap; overflow-wrap:anywhere; text-align:center; pointer-events:all; cursor:pointer; }
.bpg .bpg-edge-label[aria-pressed=true] { border-color:var(--ink); outline:1.5px solid var(--ink); }
.bpg .bpg-edge-label:focus-visible { outline:2px solid var(--ink); outline-offset:3px; }
.bpg .bpg-edge-name { position:absolute; pointer-events:none; padding:2px 7px; border:1px solid var(--hair-2); background:var(--paper); color:var(--ink); font:500 12px/1.3 var(--lettering); white-space:nowrap; }
.bpg .react-flow__minimap { background:var(--paper); border:1px solid var(--hair-2); border-radius:2px; margin:10px; }
.bpg .react-flow__minimap-mask { fill:var(--paper-2); fill-opacity:.7; stroke:var(--ink); stroke-width:2; }
.bpg .react-flow__attribution { display:none; }

/* The bar under the drawing takes its own space, so the drawing ends at its
   top edge: the drawing's name, the scale with zoom and fit, the key and the
   notes. A narrow canvas keeps the controls and drops the name. */
.bpg-controls { position:relative; z-index:5; flex:none; display:flex; align-items:center; gap:2px; min-height:40px; padding:0 4px 0 12px; border-top:1px solid var(--hair); background:var(--paper); color:var(--ink); font-family:var(--lettering); }
.bpg-controls-title { flex:1 1 auto; min-width:0; padding-right:8px; font-size:14px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bpg .bpg-controls button { min-height:36px; min-width:36px; padding:0 9px; border:0; border-radius:2px; background:transparent; color:var(--ink); font:600 13px/1.3 var(--lettering); display:grid; place-items:center; white-space:nowrap; }
.bpg .bpg-controls button:hover { background:var(--paper-2); }
.bpg .bpg-controls button[aria-expanded=true] { background:var(--ink); color:var(--paper); }
.bpg .bpg-controls button svg { width:14px; height:14px; }
.bpg-controls .bpg-pop { position:absolute; right:8px; bottom:calc(100% + 6px); width:min(340px,100cqw - 16px); max-height:calc(100cqh - 120px); overflow:auto; padding:12px 14px; border:1px solid var(--hair-2); background:var(--paper); color:var(--ink); font-size:13px; }
.bpg-pop p,.bpg-pop li { font-size:13px; line-height:1.45; margin:0 0 8px; max-width:none; }
.bpg-pop ul { margin:0; padding-left:18px; }
.bpg-pop ul li:last-child { margin-bottom:0; }
@container canvas (max-width: 420px) {
  .bpg-controls { padding-left:4px; }
  .bpg-controls-title { display:none; }
}

/* The key of the folded pictures and the Code map: each kind of box and arrow as it is drawn. */
.bpg-key { position:relative; font-size:12.5px; line-height:1.5; margin:0 0 10px; color:var(--ink); }
.bpg-key>div { display:flex; flex-wrap:wrap; gap:4px 12px; align-items:center; margin:4px 0; }
.bpg-key>div>strong { min-width:44px; font-size:12.5px; font-weight:600; }
.bpg-key span { display:inline-flex; align-items:center; gap:6px; text-transform:capitalize; }
.bpg-key svg,.bpg-key i { flex-shrink:0; }
.bpg-key-box { width:14px; height:12px; border:2px solid var(--k); background:color-mix(in srgb,var(--k) var(--wash),var(--paper)); }
.bpg-key p { font-size:12.5px; color:var(--ink-2); margin:6px 0 0; }
.bpg .bpg-term { display:inline-flex; align-items:center; gap:6px; border:0; padding:2px 4px; min-height:28px; background:transparent; color:var(--ink); font:inherit; text-align:left; }
.bpg-term>span { text-decoration:underline dotted; text-underline-offset:3px; }
.bpg .bpg-term:hover { background:var(--paper-2); }
.bpg-term-help { position:absolute; z-index:20; width:300px; max-width:100%; padding:10px 12px; border:1px solid var(--hair-2); background:var(--paper); color:var(--ink); overflow-wrap:anywhere; }
.bpg-term-help>strong { text-transform:capitalize; font-size:13px; }
.bpg-key .bpg-term-help p { font-size:13px; color:var(--ink); text-transform:none; }
ul.bpg-notation-key { list-style:none; margin:0 0 8px; padding:0; }
.bpg-notation-key li { display:flex; gap:10px; align-items:center; margin:0 0 7px; }
.bpg-notation-key svg { flex-shrink:0; color:var(--ink); stroke:currentColor; stroke-width:1.3; fill:none; }
.bpg-key-component,.bpg-key-interface,.bpg-key-node { stroke:var(--k); stroke-width:1.6; fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); }
.bpg-key-component { --k:var(--tone-blue); }
.bpg-key-interface { --k:var(--tone-teal); }
.bpg-key-node { --k:var(--tone-rose); }
.bpg-key-lane { stroke:var(--k); stroke-width:2; fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); }
.bpg-key-failure { color:var(--red); }
.bpg-key-recovery { color:var(--ink-2); }

/* The standard notations: one drawing, panned and zoomed by the frame. */
.bpg-frame { touch-action:none; cursor:grab; user-select:none; -webkit-user-select:none; }
.bpg-frame[data-dragging] { cursor:grabbing; }
.bpg-frame>svg { display:block; width:100%; flex:1 1 0; min-height:0; color:var(--ink-2); }
.bpg-frame svg text { font-family:var(--lettering); font-size:12.5px; fill:var(--ink); stroke:none; }
.bpg-frame g[role=button] { cursor:pointer; }
@media (hover:hover) { .bpg-frame g[role=button]:hover text { text-decoration:underline; } }
.bpg-frame g[role=button]:focus-visible { outline:none; }
.bpg-frame g[role=button]:focus-visible rect,.bpg-frame g[role=button]:focus-visible path:not(.bpg-seq-hit) { stroke:var(--ink); stroke-width:3; }
.bpg-structural-node { --k:var(--tone-blue); }
.bpg-structural-node[data-symbol=person] { --k:var(--tone-navy); }
.bpg-structural-node[data-symbol=interface],.bpg-structural-node[data-symbol=class] { --k:var(--tone-teal); }
.bpg-structural-node[data-symbol=node] { --k:var(--tone-rose); }
.bpg-structural-node[data-external] { --k:var(--tone-grey); }
.bpg-structural-node .bpg-uml-faces path { fill:color-mix(in srgb,var(--k) 24%,var(--paper)); stroke:var(--k); stroke-width:2; stroke-linejoin:round; }
.bpg-structural-node[data-external] .bpg-uml-faces path { fill:color-mix(in srgb,var(--k) 12%,var(--paper)); stroke-width:1.5; }
.bpg-structural-card { box-sizing:border-box; padding:9px 12px; color:var(--ink); font:12.5px/1.4 var(--lettering); overflow:hidden; }
.bpg-structural-card>strong { display:block; font-size:14px; line-height:1.25; font-weight:600; }
.bpg-structural-card p { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; margin:4px 0 0; width:100%; max-width:none!important; font-size:12.5px; line-height:1.4; }
.bpg-structural-card .bpg-kind { color:var(--k); }
.bpg-structural-node[data-external] .bpg-structural-card,.bpg-structural-node[data-external] .bpg-structural-card .bpg-kind { color:var(--ink-2); }
.bpg-structural-node rect { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:2; }
.bpg-structural-node[data-external] rect { fill:var(--paper); stroke-width:1.5; }
.bpg-structural-node[data-boundary] rect { fill:none; }
.bpg-structural-node[data-kind=requirement] { --k:var(--tone-green); }
.bpg-structural-node[data-kind=decision] { --k:var(--tone-amber); }
.bpg-structural-node[data-kind=question] { --k:var(--tone-purple); }
.bpg-structural-node[data-kind=mapping] { --k:var(--tone-grey); }
.bpg-structural-node .bpg-uml-comment { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:1.5; }
.bpg-structural-node[data-symbol=comment] .bpg-structural-card>strong { font-weight:600; }
.bpg-structural-node[data-symbol=comment] .bpg-structural-card p { -webkit-line-clamp:3; }
.bpg-structural-node[data-boundary] .bpg-structural-card { padding-bottom:0; }
.bpg-structural-node .bpg-uml-icon rect { fill:var(--paper); stroke:var(--k); stroke-width:1; }
.bpg-uml-name { text-align:center; }
.bpg-uml-name>strong { display:block; font-size:14px; line-height:1.25; font-weight:600; }
.bpg-structural-card p.bpg-uml-compartment { margin:8px -12px 0; padding:6px 12px 0; border-top:1px solid var(--k); }
.bpg-structural-card ul.bpg-uml-attributes { list-style:none; margin:8px -12px 0; padding:6px 12px 0; min-height:14px; border-top:1px solid var(--k); font:12px/1.45 var(--mono); text-align:left; }
.bpg-matrix { flex:1; min-height:0; overflow:auto; padding:16px 20px; border:1px solid var(--hair-2); background:var(--paper); font:13px/1.35 var(--lettering); color:var(--ink); }
.bpg-matrix table { border-collapse:separate; border-spacing:0; }
.bpg-matrix caption { caption-side:bottom; text-align:left; padding:10px 0 0; color:var(--ink-2); font-size:12.5px; }
.bpg-matrix th,.bpg-matrix td { border:1px solid var(--hair-2); padding:0; text-align:center; min-width:72px; }
.bpg-matrix thead th { position:sticky; top:0; z-index:1; background:var(--paper); font-weight:600; vertical-align:bottom; }
.bpg-matrix th[scope=row] { position:sticky; left:0; background:var(--paper); text-align:left; font-weight:500; white-space:nowrap; box-shadow:inset 4px 0 0 var(--k); }
.bpg-matrix thead th:first-child { padding:8px 10px; }
.bpg-matrix th button,.bpg-matrix td button { all:unset; display:block; box-sizing:border-box; width:100%; min-height:40px; padding:8px 10px; color:var(--blue); cursor:pointer; }
.bpg-matrix th[scope=row] button { padding-left:14px; }
.bpg-matrix td button { font-weight:600; text-decoration:underline; text-underline-offset:3px; }
.bpg-matrix button:hover { text-decoration:underline; background:var(--hair); }
.bpg-matrix button:focus-visible { outline:2px solid var(--blue); outline-offset:-2px; }
.bpg-matrix td>span { display:block; padding:8px 10px; color:var(--ink-3); }
.bpg-matrix>p { margin:12px 0 0; font-size:12px; }
.bpg-structural-edge { color:var(--ink-2); }
.bpg-structural-edge path:not(.bpg-seq-hit) { fill:none; stroke:currentColor; stroke-width:1.25; }
.bpg-frame .bpg-structural-edge.is-near,.bpg-frame .bpg-structural-edge.is-selected { color:var(--ink); }

/* UML frames, notes and fragments; the activity's lanes and nodes and the
   sequence's lifelines, each in its part's hue. */
.bpg-uml-frame rect { fill:none; stroke:var(--ink-2); stroke-width:1.25; }
.bpg-uml-frame path { fill:var(--paper); stroke:var(--ink-2); stroke-width:1.25; }
.bpg-frame svg .bpg-uml-frame text,.bpg-frame svg text.bpg-uml-keyword { font-weight:600; }
.bpg-uml-note path { fill:var(--paper); stroke:var(--ink-2); stroke-width:1; }
.bpg-uml-fragment rect { fill:none; stroke:var(--ink); stroke-width:1; }
.bpg-uml-fragment path { fill:var(--paper); stroke:var(--ink); stroke-width:1; }
.bpg-uml-fragment line { stroke:var(--ink); stroke-width:1; }
.bpg-act-lane { --k:var(--tone-ink); }
.bpg-act-lane rect { fill:color-mix(in srgb,var(--k) 5%,var(--paper)); stroke:var(--hair-2); stroke-width:1; }
.bpg-act-lane rect.bpg-act-lane-head { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:2; }
.bpg-act-lane.is-focus rect.bpg-act-lane-head { fill:var(--k); }
.bpg-frame svg .bpg-act-lane.is-focus text { fill:var(--paper); }
.bpg-frame svg .bpg-act-lane text { font-weight:600; font-size:13px; }
.bpg-act-node { --k:var(--tone-ink); }
.bpg-act-box { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:1.5; }
.bpg-act-node.is-focus .bpg-act-box { stroke-width:2.75; }
.bpg-act-diamond { fill:var(--paper); stroke:var(--ink); stroke-width:1.5; }
.bpg-act-solid { fill:var(--ink); }
.bpg-act-ring { fill:none; stroke:var(--ink); stroke-width:1.5; }
.bpg-act-flow { color:var(--ink); }
.bpg-act-flow path:not(.bpg-seq-hit) { fill:none; stroke:currentColor; stroke-width:1.5; }
.bpg-act-flow[data-kind=failure],.bpg-seq-message[data-kind=failure] { color:var(--red); }
.bpg-act-flow[data-kind=recovery],.bpg-seq-message[data-kind=recovery] { color:var(--ink-2); }
.bpg-act-flow text { fill:currentColor; }
.bpg-frame svg text.bpg-act-outcome { fill:var(--ink-2); font-size:11.5px; }
.bpg-act-flow .bpg-seq-hit { stroke:transparent; stroke-width:20; pointer-events:stroke; fill:none; }
.bpg-frame .bpg-act-node.is-selected .bpg-act-box,.bpg-frame .bpg-act-flow.is-selected path:not(.bpg-seq-hit) { stroke:var(--ink); stroke-width:3; }
.bpg-frame .bpg-act-flow.is-selected { color:var(--ink); }
.bpg-frame[data-selected] .bpg-act-node:not(.is-selected):not(.is-near),.bpg-frame[data-selected] .bpg-act-flow:not(.is-selected):not(.is-near) { opacity:.4; }
.bpg-seq-lifeline { --k:var(--tone-ink); }
.bpg-seq-lifeline rect { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:2; }
.bpg-frame svg .bpg-seq-lifeline text { font-weight:600; font-size:13px; }
.bpg-seq-lifeline line { stroke:var(--k); stroke-width:1; opacity:.55; }
.bpg-seq-lifeline.is-focus rect { fill:var(--k); }
.bpg-frame svg .bpg-seq-lifeline.is-focus text { fill:var(--paper); }
.bpg-seq-event { --k:var(--tone-ink); }
.bpg-seq-event rect { fill:color-mix(in srgb,var(--k) var(--wash),var(--paper)); stroke:var(--k); stroke-width:1.5; }
.bpg-seq-event .bpg-seq-hit { fill:transparent; stroke:none; }
.bpg-seq-message { color:var(--ink); }
.bpg-seq-message path:not(.bpg-seq-hit) { fill:none; stroke:currentColor; stroke-width:1.5; }
.bpg-seq-message[data-kind=reply] { color:var(--ink-2); }
.bpg-seq-message text { fill:currentColor; }
.bpg-frame svg text.bpg-seq-label { paint-order:stroke; stroke:var(--paper); stroke-width:4px; stroke-linejoin:round; }
.bpg-seq-message .bpg-seq-hit { stroke:transparent; stroke-width:24; pointer-events:stroke; fill:none; }
.bpg-frame .is-selected rect,.bpg-frame .bpg-seq-message.is-selected path:not(.bpg-seq-hit),.bpg-frame .bpg-structural-edge.is-selected path:not(.bpg-seq-hit) { stroke:var(--ink); stroke-width:3; }
.bpg-frame .bpg-seq-message.is-selected { color:var(--ink); }
.bpg-frame[data-selected] .bpg-structural-node:not(.is-selected):not(.is-near):not([data-boundary]),.bpg-frame[data-selected] .bpg-seq-event:not(.is-selected):not(.is-near) { opacity:.4; }
.bpg-frame[data-selected] .bpg-structural-edge:not(.is-selected):not(.is-near),.bpg-frame[data-selected] .bpg-seq-message:not(.is-selected):not(.is-near) { opacity:.22; }
@media(prefers-reduced-motion:reduce) { .bpg-frame * { transition:none!important; } }
`;
