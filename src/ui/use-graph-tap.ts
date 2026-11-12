import { useEffect, useRef, type HTMLAttributes } from "react";
import { graphTap } from "./graph-tap.ts";
const itemSelector = ".react-flow__node,.react-flow__edge,.bpg-edge-label";

export function useGraphTap(
  phone: boolean,
  select: (id: string) => void,
): HTMLAttributes<HTMLDivElement> {
  const gesture = useRef(graphTap());
  const lastTouch = useRef(-Infinity);
  useEffect(() => {
    gesture.current = graphTap();
    lastTouch.current = -Infinity;
  }, [phone]);
  return {
    onPointerDownCapture(event) {
      if (!phone) return;
      if (event.pointerType !== "touch") {
        lastTouch.current = -Infinity;
        return;
      }
      const target = (event.target as Element).closest(itemSelector);
      const id =
        target?.getAttribute("data-id") ??
        target?.getAttribute("data-edge-id") ??
        null;
      gesture.current.down(
        event.pointerId,
        id,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
    },
    onPointerMoveCapture(event) {
      if (phone && event.pointerType === "touch")
        gesture.current.move(event.pointerId, event.clientX, event.clientY);
    },
    onPointerUpCapture(event) {
      if (!phone || event.pointerType !== "touch") return;
      lastTouch.current = event.timeStamp;
      const id = gesture.current.up(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.timeStamp,
      );
      if (id) select(id);
    },
    onPointerCancelCapture(event) {
      if (event.pointerType !== "touch") return;
      lastTouch.current = event.timeStamp;
      gesture.current.cancel(event.pointerId);
    },
    onClickCapture(event) {
      // A touch has already selected on pointer-up (or was a drag/pinch).
      // Ignore its compatibility click; keyboard and later mouse clicks work.
      if (
        phone &&
        (event.target as Element).closest(itemSelector) &&
        event.detail !== 0 &&
        event.timeStamp - lastTouch.current < 800
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
  };
}
