import { describe, expect, it } from "vitest";
import { CollectionAccess, validatePrivateCircleForm } from "./contract";

const future = "2099-01-01T00:00";
const base = { title: "Savings", recipient: "0x0000000000000000000000000000000000000001", access: CollectionAccess.Open, invitees: [], target: "", deadline: future };

describe("Private Circle validation", () => {
  it("accepts an open collection without invitees", () => expect(validatePrivateCircleForm(base)).toEqual([]));
  it("requires unique valid invitees for invite-only collections", () => {
    expect(validatePrivateCircleForm({ ...base, access: CollectionAccess.InviteOnly, invitees: [base.recipient, base.recipient] })).toContain("Invitee addresses must be unique.");
  });
  it("rejects invitees on open collections and invalid targets", () => {
    expect(validatePrivateCircleForm({ ...base, invitees: [base.recipient], target: "0" })).toEqual(expect.arrayContaining(["Open collections cannot include invitees.", "The target must be a positive whole number."]));
  });
  it("rejects invalid recipients and expired deadlines", () => {
    expect(validatePrivateCircleForm({ ...base, recipient: "0x0", deadline: "2020-01-01T00:00" })).toEqual(expect.arrayContaining(["Enter a valid nonzero recipient address.", "Choose a future deadline."]));
  });
});
