import type { Records } from "../../application/records.ts";
import type { Planning, Actor } from "../../application/planning.ts";
import type { SessionState } from "../../application/session-state.ts";
import type { CodebaseGeneration } from "../../application/codebase-generation.ts";
import type { ProjectMap } from "../../application/project-map.ts";
import type { Review } from "../../application/review.ts";
import type { Navigation } from "../../application/navigation.ts";
import type { providerPricing } from "./provider-pricing.ts";
import type { ModelServices } from "./models.ts";
import type { SessionLifecycle } from "./session-lifecycle.ts";
import type { NativeWorkspace } from "./native-session.ts";
import type { BuildRuns } from "../../application/build/index.ts";
import type { MapRefresher } from "../../application/map-refresh.ts";
export interface RequestServices {
  records: Records;
  planning: Planning;
  sessions: SessionState;
  generation: CodebaseGeneration;
  projectMap: ProjectMap;
  review: Review;
  navigation: Navigation;
  pricing: ReturnType<typeof providerPricing>;
  models: ModelServices;
  lifecycle: SessionLifecycle;
  builds: BuildRuns;
  refresher: MapRefresher;
  bound(workspace: unknown): {
    ws: NativeWorkspace;
    actor: Actor;
    readonly source: unknown;
  };
}
export type RequestPayload = Record<string, unknown>;
