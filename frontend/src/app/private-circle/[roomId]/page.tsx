import { PrivateCircleRoom } from "@/features/private-circle/private-circle-room";
export default async function PrivateCircleRoomPage({ params }: { params: Promise<{ roomId: string }> }) { const { roomId } = await params; if (!/^\d+$/.test(roomId) || BigInt(roomId) === 0n) return <p className="p-8">Collection not found.</p>; return <PrivateCircleRoom roomId={BigInt(roomId)} />; }
