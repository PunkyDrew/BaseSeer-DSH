import { spawnSync, type ChildProcess } from "node:child_process";

/**
 * Stops a process and everything it started. A shell running a dev server or
 * a browser leaves child processes behind when only the shell is killed.
 */
export function stopProcessTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32")
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
    });
  else child.kill("SIGKILL");
}
