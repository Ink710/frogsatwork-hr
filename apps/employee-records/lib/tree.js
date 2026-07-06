// Turn a flat list of nodes into a forest of trees using each item's managerId.
// Pure and side-effect-free so it's trivially unit-testable.
//
// items: [{ id, managerId, ...nodeFields }]
// returns: roots — each node is { ...nodeFields, children: [...] }. A node is a ROOT when
// its managerId is null OR its manager isn't present in `items` (e.g. an RLS-scoped slice
// where the boss isn't visible). Only manager links WITHIN the set are followed, so a
// scoped subset always yields a valid, cycle-free forest.
export function buildTree(items) {
  const byId = new Map();
  for (const it of items) {
    const { managerId, ...rest } = it;
    byId.set(it.id, { ...rest, children: [] });
  }

  const roots = [];
  for (const it of items) {
    const node = byId.get(it.id);
    if (it.managerId && byId.has(it.managerId)) {
      byId.get(it.managerId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}
