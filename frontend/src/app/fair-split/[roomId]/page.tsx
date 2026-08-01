import { FairSplitRoom } from "@/features/fair-split/fair-split-room";

export default async function FairSplitRoomPage({ params }: { params: Promise<{ roomId: string }> }) {
  const { roomId } = await params;
  return <FairSplitRoom roomIdText={roomId} />;
}
