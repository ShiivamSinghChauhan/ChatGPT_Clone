import type { MessageNode } from "../api/types";

/** Key used in the child index for messages whose parent_id is null. */
export const ROOT = "__root__";

export type ChildIndex = Map<string, MessageNode[]>;

function time(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Oldest first; ties keep insertion order (Array.prototype.sort is stable). */
export function byCreatedAt(a: MessageNode, b: MessageNode): number {
  return time(a.created_at) - time(b.created_at);
}

export function buildChildIndex(nodes: Record<string, MessageNode>): ChildIndex {
  const index: ChildIndex = new Map();
  for (const node of Object.values(nodes)) {
    const key = node.parent_id ?? ROOT;
    const list = index.get(key);
    if (list) list.push(node);
    else index.set(key, [node]);
  }
  for (const list of index.values()) list.sort(byCreatedAt);
  return index;
}

/** Walks down from `nodeId`, always following the newest child, and returns the leaf id. */
export function newestLeaf(index: ChildIndex, nodeId: string): string {
  let current = nodeId;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const children = index.get(current);
    if (!children?.length) return current;
    current = children[children.length - 1].id;
  }
  return current;
}

/**
 * The visible conversation: root → … → leaf.
 * Falls back to the newest branch when `leafId` is missing or unknown.
 */
export function activePath(
  nodes: Record<string, MessageNode>,
  index: ChildIndex,
  leafId: string | null,
): MessageNode[] {
  let start = leafId && nodes[leafId] ? leafId : null;
  if (!start) {
    const roots = index.get(ROOT);
    if (!roots?.length) return [];
    start = newestLeaf(index, roots[roots.length - 1].id);
  }

  const path: MessageNode[] = [];
  const seen = new Set<string>();
  let current: MessageNode | undefined = nodes[start];
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parent_id ? nodes[current.parent_id] : undefined;
  }
  return path.reverse();
}

export function siblingsOf(index: ChildIndex, node: MessageNode): MessageNode[] {
  return index.get(node.parent_id ?? ROOT) ?? [node];
}
