import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Address } from "viem";
import {
  asPlanView,
  assertPlanComplete,
  readPlanStage,
  Stage,
  type PlanView,
} from "../scripts/live-e2e-plan.js";

const address = "0x0000000000000000000000000000000000000001" as const satisfies Address;

describe("live Sepolia E2E PlanView decoding", () => {
  it("reads stage from the named PlanView result", () => {
    const plan = asPlanView(planView({ stage: Stage.Complete }));

    assert.equal(readPlanStage(plan), Stage.Complete);
  });

  it("does not use the old positional-array stage assumption", () => {
    const plan = asPlanView({
      ...planView({ stage: Stage.Complete }),
      3: Stage.Collection,
    });

    assert.doesNotThrow(() => assertPlanComplete(plan));
  });

  it("accepts a complete plan stage", () => {
    assert.doesNotThrow(() =>
      assertPlanComplete(asPlanView(planView({ stage: Stage.Complete }))),
    );
  });

  it("rejects an incorrect plan stage", () => {
    assert.throws(
      () => assertPlanComplete(asPlanView(planView({ stage: Stage.Collection }))),
      /Expected plan stage Complete/,
    );
  });

  it("rejects a positional tuple result", () => {
    assert.throws(
      () => asPlanView([1n, "Sepolia live Plan Together", address, Stage.Complete]),
      /unexpected positional tuple/,
    );
  });
});

function planView(overrides: Partial<PlanView> = {}): PlanView {
  return {
    id: 1n,
    title: "Sepolia live Plan Together",
    organizer: address,
    stage: Stage.Budget,
    budgetRoomId: 1n,
    selectedOptionIndex: 1n,
    selectedCost: 150n,
    splitMethod: 1,
    splitRoomId: 2n,
    collectionRoomId: 3n,
    intendedRecipient: address,
    createdAt: 1n,
    updatedAt: 2n,
    ...overrides,
  };
}
