// Screen-space tap recognition: panning, pinching and cancelled contacts must
// never select a graph item. Independent of click synthesis in mobile browsers.
export function graphTap() {
  const contacts = new Set<number>();
  let candidate:
    | { pointer: number; item: string; x: number; y: number; time: number }
    | undefined;
  return {
    down(
      pointer: number,
      item: string | null,
      x: number,
      y: number,
      time: number,
    ) {
      candidate =
        contacts.size === 0 && item ? { pointer, item, x, y, time } : undefined;
      contacts.add(pointer);
    },
    move(pointer: number, x: number, y: number) {
      if (
        candidate?.pointer === pointer &&
        Math.hypot(x - candidate.x, y - candidate.y) > 8
      )
        candidate = undefined;
    },
    up(pointer: number, x: number, y: number, time: number) {
      this.move(pointer, x, y);
      const item =
        candidate?.pointer === pointer && time - candidate.time <= 500
          ? candidate.item
          : null;
      candidate = undefined;
      contacts.delete(pointer);
      return item;
    },
    cancel(pointer: number) {
      candidate = undefined;
      contacts.delete(pointer);
    },
  };
}
