import { useEffect, useState } from "react";
import { usesPhoneInput } from "./phone-input.ts";

export function usePhoneInput() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const coarse = matchMedia("(pointer: coarse)");
    const fine = matchMedia("(any-pointer: fine)");
    const hover = matchMedia("(any-hover: hover)");
    const update = () =>
      setPhone(
        usesPhoneInput({
          mobileBrowser: (
            navigator as Navigator & { userAgentData?: { mobile?: boolean } }
          ).userAgentData?.mobile,
          userAgent: navigator.userAgent,
          coarsePointer: coarse.matches,
          finePointer: fine.matches,
          hover: hover.matches,
        }),
      );
    for (const query of [coarse, fine, hover])
      query.addEventListener("change", update);
    update();
    return () => {
      for (const query of [coarse, fine, hover])
        query.removeEventListener("change", update);
    };
  }, []);
  return phone;
}
