# BaseSeer

BaseSeer is a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin for visualizing software architecture with UML diagrams and coordinating AI agents around that plan.

Plan in chat, inspect the components and their relationships, then run `/baseseer build`. Agents implement the plan, run tests, review the code and try the program. Findings go back for fixes.

## Status

Experimental. Tested on Windows 11 with **DSH `0.2.2-rc.1`** and **BaseSeer `.308`**. A real Codex-backed build and follow-up passed both reviews, 8 project tests and 6 independent CLI checks.

Earlier comparisons sometimes showed lower model costs and clearer code, but longer waits and remaining bugs—not a consistent quality win.

## Build from source

Requires Node.js `>=24.19.0 <25` and `pnpm@11.19.0`.

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
pnpm typecheck
```

DSH and model access are separate.

Back up your DSH home and projects before upgrading, and test on a separate copy. Fresh-install tests do not prove safe migration. Build agents run with full access.

## License

[Sustainable Use License 1.0](LICENSE) · [Security](SECURITY.md) · [Dependency notices and distribution requirements](third-party/UPSTREAM_SOURCES.md)
