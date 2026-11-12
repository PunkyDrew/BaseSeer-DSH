import type { ProjectEvents } from "../../application/project-events.ts";
import { text } from "../../domain/plan.ts";

// The existing DSH Fetch registry enforces browser authentication and origin checks.
// An event only tells a view to read again; it carries no state.
export function registerProjectEvents(
  ctx: any,
  events: ProjectEvents,
  resolvePlan: (session: string) => Promise<string>,
) {
  const clients = new Set<() => void>();
  const dispose = ctx.connection.fetch.register({
    path: "/api/build-plan/events",
    methods: ["GET"],
    requestBody: "buffered",
    fetch: async (request: Request) => {
      let plan: string;
      try {
        plan = await resolvePlan(
          text(
            new URL(request.url).searchParams.get("session"),
            "session",
            100,
          ),
        );
      } catch {
        return new Response("Project is unavailable", { status: 403 });
      }
      let close = () => {};
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          let ended = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          const send = (value: string) => {
            if (ended) return;
            try {
              controller.enqueue(encoder.encode(value));
            } catch {
              close();
            }
          };
          const unsubscribe = events.subscribe((changed) => {
            if (changed !== plan || timer || ended) return;
            timer = setTimeout(() => {
              timer = undefined;
              send("event: changed\ndata: {}\n\n");
            }, 100);
          });
          const heartbeat = setInterval(() => send(": connected\n\n"), 15000);
          close = () => {
            if (ended) return;
            ended = true;
            unsubscribe();
            clearInterval(heartbeat);
            clearTimeout(timer);
            request.signal.removeEventListener("abort", close);
            clients.delete(close);
            try {
              controller.close();
            } catch {
              /* Already cancelled. */
            }
          };
          clients.add(close);
          request.signal.addEventListener("abort", close, { once: true });
          if (request.signal.aborted) close();
          else send("event: changed\ndata: {}\n\n");
        },
        cancel() {
          close();
        },
      });
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      });
    },
  });
  ctx.effect(() => () => {
    for (const close of clients) close();
    return dispose();
  });
}
