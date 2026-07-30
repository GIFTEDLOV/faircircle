import { QuietBudgetRoom } from "@/features/quiet-budget/quiet-budget-room";

export default async function QuietBudgetRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <QuietBudgetRoom roomIdText={roomId} />;
}
