import { describe, it, expect } from "vitest";
import { buildTree } from "./tree.js";

describe("buildTree", () => {
  it("nests children under their manager", () => {
    const roots = buildTree([
      { id: "ceo", managerId: null, name: "CEO" },
      { id: "mgr", managerId: "ceo", name: "Mgr" },
      { id: "ic", managerId: "mgr", name: "IC" },
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe("ceo");
    expect(roots[0].children[0].id).toBe("mgr");
    expect(roots[0].children[0].children[0].id).toBe("ic");
  });

  it("treats a node whose manager isn't in the set as a root (RLS slice)", () => {
    // A manager viewing only their subtree: their own boss isn't present.
    const roots = buildTree([
      { id: "mgr", managerId: "ceo-not-here", name: "Mgr" },
      { id: "ic", managerId: "mgr", name: "IC" },
    ]);
    expect(roots.map((r) => r.id)).toEqual(["mgr"]);
    expect(roots[0].children[0].id).toBe("ic");
  });

  it("supports multiple roots (a forest)", () => {
    const roots = buildTree([
      { id: "a", managerId: null },
      { id: "b", managerId: null },
    ]);
    expect(roots).toHaveLength(2);
  });

  it("drops managerId from the node and adds children", () => {
    const [root] = buildTree([{ id: "x", managerId: null, name: "X" }]);
    expect(root).toEqual({ id: "x", name: "X", children: [] });
    expect(root).not.toHaveProperty("managerId");
  });

  it("does not mutate or share child arrays between nodes", () => {
    const roots = buildTree([
      { id: "a", managerId: null },
      { id: "b", managerId: null },
    ]);
    roots[0].children.push("sentinel");
    expect(roots[1].children).toHaveLength(0);
  });
});
