import { saveModelSettings } from "../../application/model-settings.ts";
import { PlanError, object, text } from "../../domain/plan.ts";
import { queryCode } from "./code-query.ts";

import type { RequestPayload, RequestServices } from "./request-services.ts";

export function sessionRequests(
  ctx: import("./native-session.ts").NativeSessions,
  services: RequestServices,
) {
  const {
    records,
    planning,
    sessions,
    generation,
    projectMap,
    review,
    navigation,
    pricing,
    models,
    bound,
    lifecycle,
    builds,
    refresher,
  } = services;
  const { actors, sessionWorkspace, sessionMode } = lifecycle;
  return async (endpoint: string, q: RequestPayload): Promise<unknown> => {
    switch (endpoint) {
      case "provider-pricing":
        return pricing.dispatch(q.command);
      case "session-model-settings": {
        const ws = await sessionWorkspace(text(q.session, "session", 100));
        const { actor } = bound(ws.id);
        return saveModelSettings(records, actor, q.command);
      }
      case "session-design": {
        const ws = await sessionWorkspace(text(q.session, "session", 100));
        return records.execute(bound(ws.id).actor, q.command);
      }
      case "session-models": {
        const ws = await sessionWorkspace(text(q.session, "session", 100));
        return models.query(bound(ws.id).actor, q.command);
      }
      case "session-review": {
        const ws = await sessionWorkspace(text(q.session, "session", 100)),
          { actor } = bound(ws.id);
        const c = object(q.command ?? { action: "read" }, [
          "action",
          "digest",
          "path",
        ]);
        if (c.action === "inspect") return review.inspectAsync(actor, ws.path);
        if (c.action === "read") return review.readAsync(actor, ws.path);
        if (c.action === "source")
          return review.source(
            actor,
            text(c.digest, "digest", 64),
            text(c.path, "path", 200),
          );
        throw new PlanError("DENIED", "Unknown review operation");
      }
      case "session-navigation": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session);
        // A project with no plan yet has no saved position; open at the start.
        if (!q.command && !planning.binding(ws.id))
          return { section: "Structure", selected: "", graphs: {} };
        const { actor } = bound(ws.id);
        if (!q.command) return navigation.read(actor.plan, session);
        return navigation.save(actor.plan, session, q.command);
      }
      case "session-context": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session),
          { actor } = bound(ws.id);
        if (!q.command) {
          const row = sessions.focus(actor.plan, session);
          if (!row) return null;
          const saved = row;
          const current = records
            .doc(actor.plan)
            .records.find((r) => r.id === saved.id);
          return current
            ? { id: current.id, title: current.title, version: current.version }
            : { ...saved, missing: true };
        }
        const command = object(q.command, ["clear", "id"]);
        if (command.clear === true) {
          sessions.clearFocus(actor.plan, session);
          return null;
        }
        const id = text(command.id, "selected record", 100),
          r = records.doc(actor.plan).records.find((r) => r.id === id);
        if (!r)
          throw new PlanError("UNRESOLVED", "Selected item no longer exists");
        const agent = ctx.agents.get(session);
        if (!agent)
          throw new PlanError(
            "UNAVAILABLE",
            "Open this session's chat to restore its agent first",
          );
        sessions.setFocus(actor.plan, session, { id, title: r.title });
        return { title: r.title };
      }
      case "session-code": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session);
        // Reading source needs no plan; a project that has one still has its
        // binding checked.
        if (planning.binding(ws.id)) {
          const { actor } = bound(ws.id);
          planning.actor(actor.id, actor.role, ws.id, ws.path);
        }
        return queryCode(ws.path, q.command);
      }
      case "session-plan": {
        const session = text(q.session, "session", 100),
          ws = await sessionWorkspace(session);
        // A folder with a plan is bound on first sight; a plan file changed from elsewhere is read again.
        planning.open(ws.id, ws.path);
        const binding = planning.binding(ws.id);
        if (binding) {
          planning.actor("owner", "owner", ws.id, ws.path);
          records.store.refresh(binding.plan);
        }
        if (binding && !projectMap.read(binding.plan).latest)
          void refresher.request(binding.plan, ws.path, 0);
        const plan = binding ? records.read(binding.plan) : null;
        return {
          session,
          workspace: { id: ws.id, title: ws.title },
          projectMap: !!binding && projectMap.has(binding.plan),
          ingestion: binding
            ? await generation.statusAsync(binding.plan, ws.path)
            : null,
          mode: sessionMode(session, ws.id),
          scenarioSources: plan
            ? projectMap.scenarioSources(plan.id, plan.document)
            : {},
          recordSupport: plan
            ? await projectMap.recordSupportAsync(
                plan.id,
                plan.document,
                ws.path,
              )
            : {},
          mapScope: binding
            ? projectMap.read(binding.plan).latest?.scope
            : undefined,
          // Restored sessions are loaded lazily by DSH. Retain the saved
          // enrollment indicator before the agent object is materialized.
          enabled:
            actors.get(session)?.role === "planner" ||
            !!(binding && sessions.selected(session, ws.id)),
          plan,
        };
      }
      case "session-build": {
        const session = text(q.session, "session", 100);
        const ws = await sessionWorkspace(session);
        const { actor } = bound(ws.id);
        const c = object(q.command ?? { action: "overview" }, ["action", "id"]);
        if (c.action === "overview") return builds.overview(actor.plan);
        const id = text(c.id, "build", 100);
        if (c.action === "stop") return builds.stop(actor, id);
        if (c.action === "commit") return builds.commit(actor, id);
        throw new PlanError("DENIED", "Unknown build operation");
      }
      case "session-coverage": {
        const ws = await sessionWorkspace(text(q.session, "session", 100));
        const { actor } = bound(ws.id);
        const c = object(q.command ?? {}, ["refresh"]);
        if (c.refresh === true || !projectMap.read(actor.plan).latest)
          await refresher.request(actor.plan, ws.path, 0);
        return projectMap.read(actor.plan).latest
          ? projectMap.query(
              actor.plan,
              ws.path,
              { action: "coverage" },
              "owner",
            )
          : null;
      }
      case "session-undo": {
        const ws = await sessionWorkspace(text(q.session, "session", 100));
        return records.execute(bound(ws.id).actor, {
          op: "undo",
          expected: object(q.command, ["expected"]).expected,
          key: q.key,
        });
      }

      default:
        throw new PlanError("DENIED", "Unknown owner operation");
    }
  };
}
