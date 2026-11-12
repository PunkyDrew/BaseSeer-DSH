import type { Store } from "../storage/store.ts";
import { navigation } from "../domain/navigation.ts";

/** Where each session left the views; a new session starts where the workspace was last. */
export class Navigation {
  store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  read(plan: string, session = "@workspace"): ReturnType<typeof navigation> {
    let row = this.store.navigation.read(plan, session);
    if (!row && session !== "@workspace") return this.read(plan);
    if (!row) row = this.store.navigation.latest(plan);
    return navigation(row ?? {});
  }
  save(plan: string, session: string, input: unknown) {
    const value = navigation(input);
    for (const key of new Set([session, "@workspace"]))
      this.store.navigation.save(plan, key, value);
    return value;
  }
}
