import type { defineTool } from "@deepseek-ai/dsh-tools";

// Only the installed DSH session surface used by this adapter. Application
// services never receive a native agent, tool registry or maintenance handle.
export type Release = () => void;
export type NativeTool = ReturnType<typeof defineTool>;
export interface NativeWorkspace {
  id: string;
  path: string;
  title: string;
  sessionIds: string[];
  attachSession(id: string): Promise<unknown>;
}
export interface NativeUserMessage {
  id: string;
  role: "user";
  source: { kind: string };
  content: readonly { type: string; text?: string }[];
}
export interface NativeAgent {
  id: string;
  status: string;
  session: {
    /** origin is "subagent" for a session another started, which parentSession names. */
    header: { cwd?: string; origin?: string; parentSession?: string };
    append?(type: string, data: unknown): unknown;
  };
  ctx: NativeAgentContext;
  runMaintenance<T>(operation: () => Promise<T>): Promise<T>;
  whenIdle(): Promise<void>;
  steer(message: NativeUserMessage): void;
  inbox: {
    nextTurn: readonly NativeUserMessage[];
    nextStep: readonly NativeUserMessage[];
    remove(id: string): unknown;
  };
}
export interface NativeAgentContext {
  on(
    event: "session/event",
    listener: (session: { id: string }, event: unknown) => void,
  ): Release;
  tools: {
    register(tool: NativeTool): Release;
    restrict(scope: { allow?: string[]; deny?: string[] }): Release;
    get(name: string, agent: NativeAgent): NativeTool | undefined;
  };
  systemPrompt: {
    section(section: {
      name: string;
      order: number;
      text: () => string;
    }): Release;
  };
  on(
    event: "agent/pre-step",
    listener: (
      event: {
        agent: NativeAgent;
        turn: number;
        step: number;
        messages: NativeUserMessage[];
        signal: AbortSignal;
      },
      next: () => Promise<unknown>,
    ) => Promise<unknown>,
  ): Release;
  on(
    event: "agent/assistant-stream",
    listener: (event: {
      agent: NativeAgent;
      frame: {
        type: string;
        attemptId: string;
        turn?: number;
        chunk?: { type: string; reason?: { kind: string } };
        outcome?: { kind: string; eventType?: string };
      };
    }) => void,
  ): Release;
  on(
    event: "agent/turn-stopping",
    listener: (event: {
      agent: NativeAgent;
      turn: number;
      signal: AbortSignal;
    }) => Promise<void> | void,
  ): Release;
  on(
    event: "agent/error",
    listener: (event: { error: unknown }) => void,
  ): Release;
}
export interface NativeAgentPresets {
  composedPreset(scope: NativeAgentContext): string | undefined;
  resolve(id?: string): Promise<{ id: string }>;
  select(agent: NativeAgent, id: string): Promise<string>;
}
export interface NativeSessionProjections {
  stateOf(session: NativeAgent["session"], key: string): unknown;
}
export interface NativeSessions {
  agents: { get(id: string): NativeAgent | undefined; roots(): NativeAgent[] };
  get?(name: string): unknown;
  tools: {
    guard(
      check: (exec: {
        agent?: NativeAgent;
        name: string;
      }) => string | undefined,
    ): Release;
    get(name: string, agent: NativeAgent): NativeTool | undefined;
  };
  workspaceRegistry: {
    get(id: string): NativeWorkspace | undefined;
    list?(): NativeWorkspace[];
    resolveByPath(path: string): Promise<NativeWorkspace | undefined>;
  };
  sessionPersistence: {
    stat(id: string): Promise<{ header: { cwd?: string } } | undefined>;
  };
  sessionController: {
    resolveAgent(
      id: string,
    ): Promise<
      { error: Error; agent?: never } | { error?: never; agent: NativeAgent }
    >;
    cancel(request: { sessionId: string }): Promise<unknown>;
    prompt(
      request: {
        requestId: string;
        sessionId: string;
        mode: "queue";
        content: { type: "text"; text: string }[];
      },
      signal: AbortSignal,
    ): Promise<unknown>;
  };
  /** prepend runs the listener before those already registered. */
  on(
    event: "agent/created" | "agent/disposed",
    listener: (event: { agent: NativeAgent }) => void,
    prepend?: boolean,
  ): Release;
  on(
    event: "session/event",
    listener: (session: { id: string }, event: unknown) => void,
    prepend?: boolean,
  ): Release;
  on(event: "tools/change", listener: () => void, prepend?: boolean): Release;
}
