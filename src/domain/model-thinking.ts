// Reasoning names and defaults belong to each resolved provider/model route.
// Never translate a shared label into a presumed cross-provider effort scale.
export function modelThinking(model: any) {
  if (model.metadata === "unresolved")
    return { options: [], defaultChoice: "" };
  const efforts = model.reasoning?.efforts ?? [];
  if (!Array.isArray(efforts)) throw new Error("Invalid thinking metadata");
  const options = efforts.map((effort: any) => {
    if (typeof effort.id !== "string" || !effort.id.trim())
      throw new Error("Invalid thinking level");
    return {
      id: effort.id,
      name: typeof effort.name === "string" ? effort.name : effort.id,
      ...(typeof effort.description === "string"
        ? { description: effort.description }
        : {}),
    };
  });
  if (new Set(options.map((o) => o.id)).size !== options.length)
    throw new Error("Duplicate thinking level");
  if (!options.length)
    return {
      options: [
        {
          id: "default",
          name: "Provider default",
          description:
            "This route exposes no selectable thinking level. Default does not mean reasoning is off.",
        },
      ],
      defaultChoice: "default",
    };
  const declared = model.reasoning?.defaultEffort;
  return {
    options,
    defaultChoice: options.some((o) => o.id === declared)
      ? (declared as string)
      : options.length === 1
        ? options[0].id
        : "",
  };
}
