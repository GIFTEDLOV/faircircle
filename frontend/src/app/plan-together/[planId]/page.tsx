import { PlanTogetherRoom } from "@/features/plan-together/plan-together-room";
export default async function PlanTogetherRoomPage({ params }: { params: Promise<{ planId: string }> }) { const { planId } = await params; if (!/^\d+$/.test(planId) || BigInt(planId) === 0n) return <p className="p-8">Plan not found.</p>; return <PlanTogetherRoom planId={BigInt(planId)} />; }
