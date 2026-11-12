import type { Store } from "../storage/store.ts";
import type { Focus } from "../storage/project-local.ts";

// Which DSH sessions plan in which workspace, and the record each has in
// focus. Host admission and the sessions' lifecycle belong to the DSH adapter.
export class SessionState {
  private store: Store;
  constructor(store: Store) {
    this.store = store;
  }
  selected(session: string, workspace?: string) {
    return this.store.sessions.session(session, workspace);
  }
  enroll(session: string, workspace: string) {
    this.store.sessions.enroll(session, workspace);
  }
  unenroll(session: string) {
    this.store.sessions.unenroll(session);
  }
  focus(plan: string, session: string) {
    return this.store.navigation.focus(plan, session);
  }
  setFocus(plan: string, session: string, value: Focus) {
    this.store.navigation.setFocus(plan, session, value);
  }
  clearFocus(plan: string, session: string) {
    this.store.navigation.clearFocus(plan, session);
  }
}
