import type { Document, PlanningRecord } from "../domain/records.ts";
import type { Generation } from "../contracts/generation.ts";
import type {
  RecordSupport,
  ScenarioSource,
} from "../contracts/project-map.ts";
import type { Notation } from "./notations/types.ts";

export type WorkspaceCall = (op: string, payload?: unknown) => Promise<any>;
export type ViewName = "Structure" | "Code" | "Behavior" | "Work";
export const workspaceViews: ViewName[] = ["Structure", "Code", "Behavior", "Work"];
export type GraphCamera = {
  x: number;
  y: number;
  zoom: number;
  layoutSignature?: string;
};
export type CameraBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** Geometry only: edits to status or selection do not invalidate a camera. */
export function cameraLayoutSignature(boxes: CameraBox[]): string {
  const geometry = JSON.stringify(
    [...boxes]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map(({ id, x, y, width, height }) => [id, x, y, width, height]),
  );
  let hash = 2166136261;
  for (let i = 0; i < geometry.length; i++)
    hash = Math.imul(hash ^ geometry.charCodeAt(i), 16777619);
  return `layout-1:${(hash >>> 0).toString(16)}`;
}
/** A camera saved without a layout signature must still show a useful part of a node. */
export function usableGraphCamera(
  camera: GraphCamera,
  boxes: CameraBox[],
  width: number,
  height: number,
  signature: string,
): boolean {
  if (
    camera.layoutSignature !== undefined &&
    camera.layoutSignature !== signature
  )
    return false;
  if (
    ![camera.x, camera.y, camera.zoom, width, height].every(Number.isFinite) ||
    camera.zoom <= 0 ||
    width <= 0 ||
    height <= 0
  )
    return false;
  return boxes.some((box) => {
    const w = box.width * camera.zoom,
      h = box.height * camera.zoom;
    const x = box.x * camera.zoom + camera.x,
      y = box.y * camera.zoom + camera.y;
    const overlap =
      Math.max(0, Math.min(width, x + w) - Math.max(0, x)) *
      Math.max(0, Math.min(height, y + h) - Math.max(0, y));
    return w > 0 && h > 0 && overlap / (w * h) >= 0.2;
  });
}
export interface GraphNavigation {
  selected?: string;
  viewport?: GraphCamera;
  layers?: {
    dependencies?: boolean;
    traceability?: boolean;
    sources?: boolean;
  };
  scenario?: string;
  /** The part whose flows the Behavior section breaks down; none shows every flow. */
  part?: string;
  folder?: string;
  dependencies?: boolean;
  notation?: Notation;
}
export interface WorkspacePlan {
  id: string;
  title: string;
  revision: number;
  document: Document;
  history: {
    revision: number;
    reason: string;
    actor: string;
    time: string;
    changes: { id: string; title: string; action: string }[];
  }[];
  baseline: string | null;
  baselines: {
    id: string;
    title: string;
    revision: number;
    document: Document;
  }[];
  proposals: {
    id: string;
    title: string;
    rationale: string;
    status: string;
    changes: PlanningRecord[];
  }[];
}
export interface WorkspaceState {
  session?: string;
  workspace: { id: string; title: string };
  enabled: boolean;
  projectMap: boolean;
  mapScope?: string;
  ingestion?: Generation | null;
  mode?: { value: string };
  plan: WorkspacePlan | null;
  recordSupport?: RecordSupport;
  scenarioSources?: Record<string, ScenarioSource>;
}
// Network envelopes are checked here; command/domain validation remains on the
// authenticated server. This is not a replacement parser for stored documents.
export function workspaceResult(value: unknown): WorkspaceState {
  const v = value as WorkspaceState | null;
  if (
    !v ||
    typeof v.workspace?.id !== "string" ||
    typeof v.workspace.title !== "string" ||
    (v.plan &&
      (!Number.isSafeInteger(v.plan.revision) ||
        !Array.isArray(v.plan.document?.records) ||
        !Array.isArray(v.plan.history)))
  )
    throw new Error(
      "The shared plan response could not be read. Reconnect to try again.",
    );
  return v;
}
