import { useRef, useState } from "react";
import type { SourceRequest } from "./source-view.tsx";

export function useSourceFocus() {
  const [sourceRequest, setSourceRequest] = useState<SourceRequest | null>(
    null,
  );
  const origin = useRef<HTMLElement | null>(null);
  const openSource = (request: SourceRequest, element: HTMLElement) => {
    origin.current = element;
    setSourceRequest(request);
  };
  const closeSource = () => {
    setSourceRequest(null);
    requestAnimationFrame(() => {
      if (
        origin.current?.isConnected &&
        !origin.current.closest('[aria-hidden="true"]')
      ) {
        origin.current.focus({ preventScroll: true });
        origin.current.scrollIntoView({
          block: "nearest",
          behavior: "instant",
        });
      }
    });
  };
  return { sourceRequest, setSourceRequest, openSource, closeSource };
}
