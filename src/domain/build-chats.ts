/**
 * The titles of the chats BaseSeer starts among the project's chats, a
 * build's lead and reviewers, a validation and a plan review: the owner can
 * watch them work there, and talks to BaseSeer only in the Planning chat,
 * whose messages every build reads.
 */
export const BUILD_CHAT_TITLES = {
  lead: "BaseSeer build (watch only)",
  reviewer: "BaseSeer review (watch only)",
  tester: "BaseSeer use test (watch only)",
  validator: "BaseSeer validation (watch only)",
  planReviewer: "BaseSeer plan review (watch only)",
} as const;

export type BuildChatTitles = typeof BUILD_CHAT_TITLES;
