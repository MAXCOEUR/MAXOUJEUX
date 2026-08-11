import type { BlackjackView } from "@maxoujeux/shared";

export function isNewerBlackjackView(current: BlackjackView | null, incoming: BlackjackView): boolean {
  return !current || current.id !== incoming.id || incoming.version > current.version;
}
