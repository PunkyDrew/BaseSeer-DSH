export interface PhoneInput {
  mobileBrowser?: boolean;
  userAgent: string;
  coarsePointer: boolean;
  finePointer: boolean;
  hover: boolean;
}

// Width cannot distinguish a phone from a narrow desktop window. Require a
// mobile-browser signal as well as touch-primary input; keep hybrid/mouse
// contexts on the existing desktop presentation. UA fallback covers browsers
// without userAgentData. Desktop-site mode remains conservatively unchanged.
export function usesPhoneInput(input: PhoneInput): boolean {
  const mobile =
    input.mobileBrowser ??
    (/iPhone|iPod|Android.*Mobile/i.test(input.userAgent) &&
      !/Windows|Macintosh|CrOS/i.test(input.userAgent));
  return mobile && input.coarsePointer && !input.finePointer && !input.hover;
}
