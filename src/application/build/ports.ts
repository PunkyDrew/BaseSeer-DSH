import net from "node:net";
import { PlanError } from "../../domain/plan.ts";

// The acceptance check and each subagent of a build get a port of their own
// for the servers they start, so a server one of them left running never
// answers for another. A build takes a block of ports well above the usual
// dev-server ports and below those the system hands out for outgoing
// connections, the first for its check. Any program on the machine may
// already serve on a port of a block, so a build takes a block that is free
// whole, picked at random to keep builds of different projects apart.
const PORT_BLOCK = 100;
const FIRST_PORT = 20_000;
/** Where the system's dynamic ports start, on Windows as in the IANA ranges. */
const DYNAMIC_PORTS = 49_152;
const BLOCKS = Math.floor((DYNAMIC_PORTS - FIRST_PORT) / PORT_BLOCK);

function listens(port: number, host?: string) {
  return new Promise<boolean>((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ port, host }, () => server.close(() => resolve(true)));
  });
}

/** Whether a project's server can listen on the port, on the loopback address dev servers default to and on every address. */
const free = async (port: number) => (await listens(port, "127.0.0.1")) && (await listens(port));

/** The first port of a block no program on this machine serves on. */
export async function freePortBlock() {
  const start = Math.floor(Math.random() * BLOCKS);
  for (let n = 0; n < BLOCKS; n++) {
    const first = FIRST_PORT + ((start + n) % BLOCKS) * PORT_BLOCK;
    const ports = Array.from({ length: PORT_BLOCK }, (_, n) => first + n);
    if ((await Promise.all(ports.map(free))).every(Boolean)) return first;
  }
  throw new PlanError(
    "UNAVAILABLE",
    `Every block of ${PORT_BLOCK} ports from ${FIRST_PORT} to ${DYNAMIC_PORTS - 1} has a port another program serves on, so a build has none of its own.`,
  );
}

/** The port of a build's nth subagent, counted from 1, after the check's within the build's block. */
export const subagentPort = (ports: number, n: number) => ports + 1 + ((n - 1) % (PORT_BLOCK - 1));
