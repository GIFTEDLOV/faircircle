import { getAddress, parseEventLogs, type Abi, type Address, type TransactionReceipt } from "viem";
import { fairCircleDeployment } from "@/generated/contracts";

export const coordinatorAddress = getAddress(fairCircleDeployment.contracts.FairCirclePlanTogether.address);
export const coordinatorAbi = fairCircleDeployment.contracts.FairCirclePlanTogether.abi as Abi;
export const coordinatorDeploymentBlock = BigInt(fairCircleDeployment.contracts.FairCirclePlanTogether.blockNumber);
export const fairCircleAddress = getAddress(fairCircleDeployment.contracts.FairCircle.address);
export const fairCircleAbi = fairCircleDeployment.contracts.FairCircle.abi as Abi;
export const fairCircleUsdAddress = getAddress(fairCircleDeployment.contracts.FairCircleUSD.address);

export const SplitMethod = { Equal: 0, CapacityWeighted: 1 } as const;
export const PlanStage = { Budget: 0, Split: 1, Collection: 2, Complete: 3, Cancelled: 4 } as const;

export type PlanView = { id: bigint; title: string; organizer: Address; stage: number; budgetRoomId: bigint; selectedOptionIndex: bigint; selectedCost: bigint; splitMethod: number; splitRoomId: bigint; collectionRoomId: bigint; intendedRecipient: Address; createdAt: bigint; updatedAt: bigint };

export function normalizePlanView(value: unknown): PlanView {
  const v = value as Record<string, unknown>;
  return { id: BigInt(v.id as bigint), title: String(v.title), organizer: getAddress(v.organizer as Address), stage: Number(v.stage), budgetRoomId: BigInt(v.budgetRoomId as bigint), selectedOptionIndex: BigInt(v.selectedOptionIndex as bigint), selectedCost: BigInt(v.selectedCost as bigint), splitMethod: Number(v.splitMethod), splitRoomId: BigInt(v.splitRoomId as bigint), collectionRoomId: BigInt(v.collectionRoomId as bigint), intendedRecipient: getAddress(v.intendedRecipient as Address), createdAt: BigInt(v.createdAt as bigint), updatedAt: BigInt(v.updatedAt as bigint) };
}

export function parseCoordinatorEvent(receipt: Pick<TransactionReceipt, "logs">, name: string, expected: Record<string, unknown> = {}) {
  const events = parseEventLogs({ abi: coordinatorAbi, eventName: name as never, logs: receipt.logs.filter((log) => getAddress(log.address) === coordinatorAddress), strict: true }) as Array<{ args: Record<string, unknown> }>;
  if (events.length !== 1) throw new Error(events.length === 0 ? `The confirmed receipt is missing ${name}.` : `The confirmed receipt contains multiple ${name} events.`);
  for (const [key, wanted] of Object.entries(expected)) { const actual = events[0].args[key]; if (typeof wanted === "bigint" ? BigInt(actual as bigint) !== wanted : typeof wanted === "string" && wanted.startsWith("0x") ? getAddress(actual as Address) !== getAddress(wanted as Address) : actual !== wanted) throw new Error(`The confirmed ${name} event does not match this plan.`); }
  return events[0].args;
}

export function parsePlanCreatedReceipt(receipt: Pick<TransactionReceipt, "logs">, organizer: Address) { const args = parseCoordinatorEvent(receipt, "PlanCreated", { organizer }); return { planId: BigInt(args.planId as bigint), budgetRoomId: BigInt(args.budgetRoomId as bigint) }; }
export function safePlanError(error: unknown) { return (error instanceof Error ? error.message : "The plan request failed.").replace(/https?:\/\/\S+/g, "[redacted-url]").slice(0, 360); }
