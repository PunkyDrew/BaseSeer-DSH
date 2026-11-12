// Touch-only phones: larger targets, no browser zoom on inputs, and an
// expanded mode that covers the host's own chrome. Widths are handled by the
// shared container queries.
export const phoneStyles = `
.bpv[data-phone-input] { font-size:16px; padding-left:env(safe-area-inset-left); padding-right:env(safe-area-inset-right); }
.bpv[data-phone-input] button:not(.bpv-link):not(.bpg-edge-label) { min-height:44px; }
.bpv[data-phone-input] .bpv-tabs button { min-height:44px; }
.bpv[data-phone-input] .bpv-link { display:inline-block; min-height:44px; padding:8px 2px; vertical-align:middle; }
.bpv[data-phone-input] summary { min-height:44px; padding:10px 0; }
.bpv[data-phone-input] input,.bpv[data-phone-input] select,.bpv[data-phone-input] textarea { font-size:16px; min-height:44px; }
.bpv[data-phone-input] .bpv-field select { min-height:44px; max-width:100%; }
.bpv[data-phone-input] .bpv-plan-bar>button { min-height:44px; }
.bpv[data-phone-input] .bpg-controls button { min-height:44px; min-width:44px; }
.bpv[data-phone-expanded] { position:fixed; inset:0; z-index:100; height:100dvh; padding-top:env(safe-area-inset-top); padding-bottom:env(safe-area-inset-bottom); }
`;
