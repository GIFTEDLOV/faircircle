export const RoomMode = {
  QuietBudget: 0,
  FairSplit: 1,
  PrivateCircle: 2,
  PlanTogether: 3,
} as const;

export const RoomStatus = {
  CollectingInputs: 0,
  ReadyForDecryption: 1,
  Finalized: 2,
  Cancelled: 3,
} as const;

export type RoomStatusValue = (typeof RoomStatus)[keyof typeof RoomStatus];

export const roomStatusLabels: Record<RoomStatusValue, string> = {
  [RoomStatus.CollectingInputs]: "Collecting inputs",
  [RoomStatus.ReadyForDecryption]: "Ready for results",
  [RoomStatus.Finalized]: "Finalized",
  [RoomStatus.Cancelled]: "Cancelled",
};

export function roomStatusLabel(status: number) {
  return roomStatusLabels[status as RoomStatusValue] ?? "Unknown";
}

export function roomStatusTone(status: number) {
  if (status === RoomStatus.Finalized) {
    return "success" as const;
  }
  if (status === RoomStatus.Cancelled) {
    return "warning" as const;
  }
  if (status === RoomStatus.ReadyForDecryption) {
    return "info" as const;
  }
  return "neutral" as const;
}
