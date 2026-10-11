import { describe, it, expect } from "vitest";
import { classifyByRules, classifyIntent } from "../src/main/agent/intent";
import { resolvePower, modelFor } from "../src/shared/power";
import { runCost } from "../src/shared/pricing";

describe("intent routing", () => {
  it("answers questions and routes changes without a model call", () => {
    for (const q of ["what is this", "What does this chart show?", "why is March so low", "how is this calculated?", "is this up to date", "explain the best-year comparison"]) expect(classifyByRules(q), q).toBe("ask");
    for (const c of ["make the bars blue", "add a KPI for average order value", "rename this card to Stuck work", "remove everything about wind", "use a line chart instead", "the title should be Revenue"]) expect(classifyByRules(c), c).toBe("change");
  });

  it("leaves genuinely ambiguous wording to the classifier, defaulting to change", async () => {
    expect(classifyByRules("the title is wrong")).toBeNull();
    expect((await classifyIntent("the title is wrong")).intent).toBe("change");
    expect((await classifyIntent("the title is wrong", async () => "ask")).intent).toBe("ask");
    expect((await classifyIntent("the title is wrong", async () => "change\n")).intent).toBe("change");
    expect((await classifyIntent("hmm", async () => { throw new Error("down"); })).intent).toBe("change");
  });
});

describe("power levels", () => {
  it("questions and repairs are always quick; auto picks smart or max by the ask", () => {
    expect(resolvePower("max", "ask")).toBe("quick");
    expect(resolvePower("auto", "heal")).toBe("quick");
    expect(resolvePower("auto", "edit", "make it blue")).toBe("smart");
    expect(resolvePower("auto", "build", "a dashboard of my sales")).toBe("smart");
    expect(resolvePower("auto", "build", "everything about my business, several pages")).toBe("max");
    expect(resolvePower("quick", "build", "everything")).toBe("quick");
    expect(modelFor("quick").model).toBe("gpt-6-luna");
  });

  it("scales credits, not cost, by level", () => {
    const usage = { input: 200_000, output: 10_000 };
    const smart = runCost({ model: "gpt-6.1-sol", usage, toolCalls: 10, level: "smart" });
    const max = runCost({ model: "gpt-6.1-sol", usage, toolCalls: 10, level: "max" });
    const quick = runCost({ model: "gpt-6-luna", usage: { input: 40_000, output: 800 }, toolCalls: 2, level: "quick" });
    expect(max.costUsd).toBe(smart.costUsd);
    expect(max.credits).toBeGreaterThan(smart.credits * 2.5);
    expect(quick.credits).toBe(0.1);
    expect(quick.credits).toBeLessThan(smart.credits);
  });
});
