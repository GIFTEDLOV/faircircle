import { getAddress, parseEventLogs, type Abi, type Address, type Hex, type TransactionReceipt } from "viem";
import { fairCircleDeployment } from "@/generated/contracts";

export const fairCircleAddress = getAddress(fairCircleDeployment.contracts.FairCircle.address);
export const fairCircleAbi = fairCircleDeployment.contracts.FairCircle.abi as Abi;
export const fairCircleUsdAddress = getAddress(fairCircleDeployment.contracts.FairCircleUSD.address);
export const fairCircleUsdAbi = fairCircleDeployment.contracts.FairCircleUSD.abi as Abi;
export const testUsdAddress = getAddress(fairCircleDeployment.contracts.TestUSD.address);
export const testUsdAbi = fairCircleDeployment.contracts.TestUSD.abi as Abi;

export const CollectionAccess = { Open: 0, InviteOnly: 1 } as const;
export const CollectionStatus = { Open: 0, Closed: 1, WithdrawalPending: 2, Withdrawn: 3, Cancelled: 4 } as const;

export function validatePrivateCircleForm(input: { title: string; recipient: string; access: number; invitees: string[]; target: string; deadline: string }) {
  const errors: string[] = [];
  if (!input.title.trim() || input.title.trim().length > 80) errors.push("Enter a title of 1 to 80 characters.");
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.recipient) || /^0x0{40}$/i.test(input.recipient)) errors.push("Enter a valid nonzero recipient address.");
  const invitees = input.invitees.filter(Boolean).map((value) => value.trim().toLowerCase());
  if (input.access === CollectionAccess.InviteOnly && (invitees.length < 2 || invitees.length > 8)) errors.push("Invite-only collections need 2 to 8 invitees.");
  if (input.access === CollectionAccess.Open && invitees.length !== 0) errors.push("Open collections cannot include invitees.");
  if (invitees.some((value) => !/^0x[a-f0-9]{40}$/.test(value) || /^0x0{40}$/.test(value))) errors.push("Every invitee must be a valid nonzero address.");
  if (new Set(invitees).size !== invitees.length) errors.push("Invitee addresses must be unique.");
  if (input.target && (!/^\d+$/.test(input.target) || BigInt(input.target) <= 0n)) errors.push("The target must be a positive whole number.");
  if (!input.deadline || new Date(input.deadline).getTime() <= Date.now()) errors.push("Choose a future deadline.");
  return errors;
}

export function parsePrivateCircleEvent(receipt: Pick<TransactionReceipt, "logs">, eventName: string, expected: Record<string, unknown> = {}) {
  const events = parseEventLogs({ abi: fairCircleAbi, eventName: eventName as never, logs: receipt.logs.filter((log) => getAddress(log.address) === fairCircleAddress), strict: true }) as Array<{ args: Record<string, unknown> }>;
  if (events.length !== 1) throw new Error(events.length === 0 ? `The confirmed receipt is missing ${eventName}.` : `The confirmed receipt contains multiple ${eventName} events.`);
  const args = events[0].args as Record<string, unknown>;
  for (const [key, value] of Object.entries(expected)) {
    const actual = args[key];
    if (typeof value === "bigint" ? BigInt(actual as bigint) !== value : typeof value === "string" && value.startsWith("0x") ? getAddress(actual as Address) !== getAddress(value as Address) : actual !== value) throw new Error(`The confirmed ${eventName} event does not match this operation.`);
  }
  return args;
}

export function parsePrivateCircleCreatedReceipt(receipt: Pick<TransactionReceipt, "logs">, organizer: Address) {
  const args = parsePrivateCircleEvent(receipt, "PrivateCircleCreated", { organizer });
  return { roomId: BigInt(args.roomId as bigint) };
}

export function parseContributionReceivedReceipt(receipt: Pick<TransactionReceipt, "logs">, roomId: bigint, contributor: Address) {
  const args = parsePrivateCircleEvent(receipt, "ContributionReceived", { roomId, contributor });
  return { contributionId: BigInt(args.contributionId as bigint) };
}

export function parseContributionFinalizedReceipt(receipt: Pick<TransactionReceipt, "logs">, roomId: bigint, contributionId: bigint, accepted: boolean) {
  parsePrivateCircleEvent(receipt, "ContributionFinalized", { roomId, contributionId, accepted });
}

export function parseTargetFinalizedReceipt(receipt: Pick<TransactionReceipt, "logs">, roomId: bigint, reached: boolean) {
  parsePrivateCircleEvent(receipt, "CollectionTargetFinalized", { roomId, reached });
}

export function parseWithdrawalReceipt(receipt: Pick<TransactionReceipt, "logs">, eventName: "CollectionWithdrawalRequested" | "CollectionWithdrawn", roomId: bigint, recipient: Address) {
  parsePrivateCircleEvent(receipt, eventName, { roomId, recipient });
}

export function toUnixDeadline(value: string) {
  const timestamp = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(timestamp)) throw new Error("Choose a valid future deadline.");
  return BigInt(timestamp);
}

export function sepoliaTxUrl(hash: Hex) { return `https://sepolia.etherscan.io/tx/${hash}`; }
