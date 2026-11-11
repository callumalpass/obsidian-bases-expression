import { describe, expect, it } from "vitest";
import { createEvaluationContext, evaluateToPlain, fromJs, toPlain } from "../src/index.js";

class FakeApp {
  appMenuBarManager: { app: FakeApp };
  constructor() {
    this.appMenuBarManager = { app: this };
  }
}

describe("fromJs on arbitrary object graphs (#7)", () => {
  it("converts a cyclic object, replacing the back-reference with null", () => {
    const root: Record<string, unknown> = { name: "root" };
    root.self = root;
    root.child = { parent: root, label: "child" };

    expect(toPlain(fromJs(root))).toEqual({
      name: "root",
      self: null,
      child: { parent: null, label: "child" },
    });
  });

  it("converts a cyclic array", () => {
    const list: unknown[] = [1];
    list.push(list);
    expect(toPlain(fromJs(list))).toEqual([1, null]);
  });

  it("keeps repeated references that are not cycles", () => {
    const shared = { id: 1 };
    expect(toPlain(fromJs({ a: shared, b: [shared, shared] }))).toEqual({
      a: { id: 1 },
      b: [{ id: 1 }, { id: 1 }],
    });
  });

  it("converts heavily shared graphs in linear time", () => {
    // Each level refers to the next twice: 2^60 paths, 61 objects.
    let node: Record<string, unknown> = { leaf: true };
    for (let depth = 0; depth < 60; depth += 1) node = { left: node, right: node };
    const converted = fromJs(node);
    expect(converted.type).toBe("Object");
    const branches = converted.value as Record<string, unknown>;
    expect(branches.left).toBe(branches.right);
  });

  it("evaluates expressions over context objects that reach a circular graph", () => {
    const task = {
      path: "Tasks/a.md",
      title: "Write report",
      tags: ["task"],
      basesData: { app: new FakeApp() },
    };
    const context = createEvaluationContext({ objects: { steps: { read: { output: { task } } } } });

    expect(evaluateToPlain('steps.read.output.task.title + " / " + steps.read.output.task.tags[0]', context, {
      throwOnError: true,
    })).toBe("Write report / task");
  });
});
