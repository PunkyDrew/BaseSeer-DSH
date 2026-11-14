declare module "react-dom" {
  export function createPortal(
    children: import("react").ReactNode,
    container: Element | DocumentFragment,
    key?: string | null,
  ): import("react").ReactPortal;
}
declare module "react-dom/client" {
  export function createRoot(container: Element | DocumentFragment): {
    render(children: import("react").ReactNode): void;
    unmount(): void;
  };
}