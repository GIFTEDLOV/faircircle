import { getAddress, isAddress, maxUint256, zeroAddress, type Address } from "viem";

export const TITLE_MAX_LENGTH = 80;
export const UINT256_MAX = maxUint256;

export type FieldError = {
  field: string;
  message: string;
};

export type MemberValidation =
  | { ok: true; members: Address[] }
  | { ok: false; errors: FieldError[] };

export type OptionValidation =
  | { ok: true; values: bigint[] }
  | { ok: false; errors: FieldError[] };

export function validateTitle(title: string): FieldError[] {
  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return [{ field: "title", message: "Enter a room title." }];
  }
  if (trimmed.length > TITLE_MAX_LENGTH) {
    return [{ field: "title", message: `Use ${TITLE_MAX_LENGTH} characters or fewer.` }];
  }
  return [];
}

export function validateMembers(
  values: string[],
  { min = 2, max = 8 }: { min?: number; max?: number } = {},
): MemberValidation {
  const errors: FieldError[] = [];
  const normalized: Address[] = [];
  const seen = new Set<string>();

  const trimmedValues = values.map((value) => value.trim()).filter(Boolean);
  if (trimmedValues.length < min || trimmedValues.length > max) {
    errors.push({ field: "members", message: `Add ${min} to ${max} member addresses.` });
  }

  trimmedValues.forEach((value, index) => {
    if (!isAddress(value, { strict: false })) {
      errors.push({ field: `members.${index}`, message: "Enter a valid Ethereum address." });
      return;
    }
    const address = getAddress(value);
    if (address === zeroAddress) {
      errors.push({ field: `members.${index}`, message: "The zero address cannot be a member." });
      return;
    }
    const key = address.toLowerCase();
    if (seen.has(key)) {
      errors.push({ field: `members.${index}`, message: "Member addresses must be unique." });
      return;
    }
    seen.add(key);
    normalized.push(address);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, members: normalized };
}

export function validateOptions(
  values: string[],
  maxSupportedAmount: bigint,
  { min = 1, max = 4 }: { min?: number; max?: number } = {},
): OptionValidation {
  const errors: FieldError[] = [];
  const parsed: bigint[] = [];
  const seen = new Set<string>();
  const trimmedValues = values.map((value) => value.trim()).filter(Boolean);

  if (trimmedValues.length < min || trimmedValues.length > max) {
    errors.push({ field: "options", message: `Add ${min} to ${max} option costs.` });
  }

  trimmedValues.forEach((value, index) => {
    const field = `options.${index}`;
    if (!/^\d+$/.test(value)) {
      errors.push({ field, message: "Use a whole-number amount." });
      return;
    }
    const amount = BigInt(value);
    if (amount <= 0n) {
      errors.push({ field, message: "Option costs must be positive." });
      return;
    }
    if (amount > UINT256_MAX || amount > maxSupportedAmount) {
      errors.push({ field, message: "Amount is above the supported maximum." });
      return;
    }
    const key = amount.toString();
    if (seen.has(key)) {
      errors.push({ field, message: "Option costs must be unique." });
      return;
    }
    seen.add(key);
    parsed.push(amount);
  });

  return errors.length > 0 ? { ok: false, errors } : { ok: true, values: parsed };
}

export function validateCapacity(value: string, maxSupportedAmount: bigint) {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false as const, message: "Enter a nonnegative whole-number amount." };
  }
  const amount = BigInt(trimmed);
  if (amount > UINT256_MAX || amount > maxSupportedAmount) {
    return { ok: false as const, message: "Amount is above the supported maximum." };
  }
  return { ok: true as const, value: amount };
}

export function deadlineInputToUnixSeconds(value: string, nowMs = Date.now()) {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    return { ok: false as const, message: "Choose a valid deadline." };
  }
  if (timestampMs <= nowMs) {
    return { ok: false as const, message: "Choose a future deadline." };
  }
  return { ok: true as const, value: BigInt(Math.floor(timestampMs / 1000)) };
}

export function errorsToText(errors: FieldError[]) {
  return Array.from(new Set(errors.map((error) => error.message))).join(" ");
}
