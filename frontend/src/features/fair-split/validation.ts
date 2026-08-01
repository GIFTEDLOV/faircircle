import { maxUint256 } from "viem";
import { validateMembers, validateTitle, deadlineInputToUnixSeconds, errorsToText, type FieldError } from "@/features/quiet-budget/validation";

export { deadlineInputToUnixSeconds, errorsToText, validateMembers, validateTitle };

export function validateTotalCost(value: string, maxSupportedAmount: bigint) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false as const, message: "Enter a positive whole-number total cost." };
  }
  const amount = BigInt(trimmed);
  if (amount <= 0n) {
    return { ok: false as const, message: "The total cost must be positive." };
  }
  if (amount > maxUint256 || amount > maxSupportedAmount) {
    return { ok: false as const, message: "Amount is above the supported maximum." };
  }
  return { ok: true as const, value: amount };
}

export function fairSplitErrors({
  title,
  members,
  totalCost,
  deadline,
  maxSupportedAmount,
}: {
  title: string;
  members: string[];
  totalCost: string;
  deadline: string;
  maxSupportedAmount: bigint;
}) {
  const errors: FieldError[] = [...validateTitle(title)];
  const memberResult = validateMembers(members);
  const costResult = validateTotalCost(totalCost, maxSupportedAmount);
  const deadlineResult = deadlineInputToUnixSeconds(deadline);
  if (!memberResult.ok) errors.push(...memberResult.errors);
  if (!costResult.ok) errors.push({ field: "totalCost", message: costResult.message });
  if (!deadlineResult.ok) errors.push({ field: "deadline", message: deadlineResult.message });
  return errorsToText(errors);
}
