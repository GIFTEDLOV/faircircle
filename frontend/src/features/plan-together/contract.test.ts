import { describe, expect, it } from "vitest";
import { normalizePlanView, PlanStage, SplitMethod } from "./contract";

const view = { id: 1n, title: "Plan", organizer: "0x0000000000000000000000000000000000000001", stage: 2, budgetRoomId: 3n, selectedOptionIndex: 1n, selectedCost: 50n, splitMethod: 0, splitRoomId: 4n, collectionRoomId: 5n, intendedRecipient: "0x0000000000000000000000000000000000000002", createdAt: 1n, updatedAt: 2n };
describe("Plan Together contract helpers", () => {
  it("decodes named PlanView fields", () => expect(normalizePlanView(view).selectedCost).toBe(50n));
  it("keeps exact stage and split mappings", () => { expect(PlanStage.Budget).toBe(0); expect(PlanStage.Complete).toBe(3); expect(SplitMethod.CapacityWeighted).toBe(1); });
  it("normalizes linked room identifiers", () => { const result = normalizePlanView(view); expect(result.budgetRoomId).toBe(3n); expect(result.collectionRoomId).toBe(5n); });
});
