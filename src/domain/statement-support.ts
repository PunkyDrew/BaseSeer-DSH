export type StatementSupport = {
  version: 1;
  items: {
    target: string;
    citations: number[];
    gap: string;
    relationship?: {
      path: string;
      line: number;
      column: number;
      targetPath: string;
      targetSymbol: string;
    };
  }[];
};

// Stable selectors within this version of the record. Record history preserves
// the statements and their references together; selectors never imply truth.
// Takes only the fields it reads, so records.ts can import it without a cycle.
export function materialStatements(r: { kind: string; data: any }) {
  const result: { target: string; label: string; statement: string }[] = [];
  const add = (target: string, label: string, value: unknown) => {
    if (typeof value === "string" && value.trim())
      result.push({ target, label, statement: value });
  };
  const d = r.data;
  if (r.kind === "scenario") {
    add("trigger", "Trigger", d.trigger);
    (d.preconditions ?? []).forEach((v: string, i: number) =>
      add(`preconditions.${i}`, "Precondition", v),
    );
    (d.steps ?? []).forEach((s: any, i: number) => {
      add(`steps.${i}.action`, `Step ${i + 1} action`, s.action);
      add(`steps.${i}.outcome`, `Step ${i + 1} outcome`, s.outcome);
    });
    (d.errors ?? []).forEach((v: string, i: number) =>
      add(`errors.${i}`, "Failure", v),
    );
    add("recovery", "Recovery", d.recovery);
    (d.flow?.nodes ?? []).forEach((n: any) => {
      for (const key of ["action", "state", "data"])
        add(
          `nodes.${n.id}.${key}`,
          `${n.terminal ? "Outcome" : "Action"} · ${key}`,
          n[key],
        );
    });
    (d.flow?.transitions ?? []).forEach((t: any, i: number) => {
      for (const key of ["condition", "data"])
        add(`transitions.${i}.${key}`, `${t.kind} transition · ${key}`, t[key]);
    });
    (d.flow?.messages ?? []).forEach((m: any) => {
      for (const key of ["label", "guard"])
        add(`messages.${m.id}.${key}`, `${m.kind} message · ${key}`, m[key]);
    });
  }
  if (r.kind === "component") {
    add("responsibility", "Inferred responsibility", d.responsibility);
    for (const key of ["inputs", "outputs", "state"])
      (d.observed?.[key] ?? []).forEach((v: string, i: number) =>
        add(`observed.${key}.${i}`, `Observed ${key}`, v),
      );
  }
  return result;
}
