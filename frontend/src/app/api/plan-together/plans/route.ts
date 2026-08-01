import { NextResponse, type NextRequest } from "next/server";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { getAddress, isAddress, type Address } from "viem";
import { createServerSepoliaPublicClient } from "@/lib/web3/server-public-client";
import { coordinatorAbi, coordinatorAddress, coordinatorDeploymentBlock } from "@/features/plan-together/contract";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("account");
  if (!value || !isAddress(value, { strict: false })) return NextResponse.json({ ok: false, error: { message: "Use a valid wallet address." } }, { status: 400 });
  const account = getAddress(value); try { const client = createServerSepoliaPublicClient(); const snapshot = await client.getBlockNumber(); const events = []; for (let from = coordinatorDeploymentBlock; from <= snapshot; from += 10_000n) { const to = from + 9_999n > snapshot ? snapshot : from + 9_999n; events.push(...await client.getContractEvents({ address: coordinatorAddress, abi: coordinatorAbi, eventName: "PlanCreated", fromBlock: from, toBlock: to })); }
    const plans = []; for (const event of events) { const id = BigInt((event.args as Record<string, unknown>).planId as bigint); const [plan, members] = await Promise.all([client.readContract({ address: coordinatorAddress, abi: coordinatorAbi, functionName: "getPlan", args: [id] }), client.readContract({ address: coordinatorAddress, abi: coordinatorAbi, functionName: "getPlanMembers", args: [id] })]); const p = plan as any; const member = (members as Address[]).some((m) => getAddress(m) === account); if (getAddress(p.organizer) === account || member || getAddress(p.intendedRecipient) === account) plans.push({ plan: Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v])), members }); }
    return NextResponse.json({ ok: true, account, snapshotBlock: snapshot.toString(), plans });
  } catch { return NextResponse.json({ ok: false, error: { message: "Plans could not be loaded. Try again." } }, { status: 502 }); }
}
