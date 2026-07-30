"use client";

import { useCallback, useEffect, useState } from "react";
import { getAddress, keccak256, type Address } from "viem";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ContractAddress } from "./contract-address";
import { InlineError } from "./inline-error";
import { LoadingState } from "./loading-state";
import { fairCircleDeployment } from "@/generated/contracts";
import { createFairCirclePublicClient } from "@/lib/web3/clients";

type HealthState =
  | { status: "loading"; refreshedAt?: string }
  | { status: "healthy"; data: HealthData; refreshedAt: string }
  | { status: "partial"; data?: HealthData; message: string; refreshedAt: string }
  | { status: "rpc-unavailable"; message: string; refreshedAt: string }
  | { status: "config-invalid"; message: string; refreshedAt?: string };

type HealthData = {
  nextRoomId: string;
  nextPlanId: string;
  tokenName: string;
  tokenSymbol: string;
  fairCircleReachable: boolean;
  coordinatorReachable: boolean;
  confidentialTokenReachable: boolean;
};

const coreContracts = [
  "TestUSD",
  "FairCircleUSD",
  "FairCircle",
  "FairCirclePlanTogether",
] as const;

export function DeploymentHealth() {
  const [state, setState] = useState<HealthState>({ status: "loading" });

  const refresh = useCallback(async () => {
    setState((current) => ({ status: "loading", refreshedAt: current.refreshedAt }));
    const refreshedAt = new Date().toLocaleString();
    try {
      assertGeneratedConfig();
      const client = createFairCirclePublicClient();
      const bytecodeChecks = await Promise.all(
        coreContracts.map(async (name) => {
          const contract = fairCircleDeployment.contracts[name];
          const code = await client.getBytecode({ address: contract.address });
          return {
            name,
            exists: code !== undefined && code !== "0x",
            hashMatches: code !== undefined && code !== "0x"
              ? keccak256(code) === contract.runtimeBytecodeHash
              : false,
          };
        }),
      );

      const [
        nextRoomId,
        nextPlanId,
        coordinatorCore,
        coordinatorToken,
        tokenName,
        tokenSymbol,
        underlying,
        testUsdName,
        testUsdDecimals,
      ] = await Promise.all([
        client.readContract({
          address: fairCircleDeployment.contracts.FairCircle.address,
          abi: fairCircleDeployment.contracts.FairCircle.abi,
          functionName: "nextRoomId",
        }) as Promise<bigint>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCirclePlanTogether.address,
          abi: fairCircleDeployment.contracts.FairCirclePlanTogether.abi,
          functionName: "nextPlanId",
        }) as Promise<bigint>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCirclePlanTogether.address,
          abi: fairCircleDeployment.contracts.FairCirclePlanTogether.abi,
          functionName: "fairCircleCore",
        }) as Promise<Address>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCirclePlanTogether.address,
          abi: fairCircleDeployment.contracts.FairCirclePlanTogether.abi,
          functionName: "approvedConfidentialToken",
        }) as Promise<Address>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCircleUSD.address,
          abi: fairCircleDeployment.contracts.FairCircleUSD.abi,
          functionName: "name",
        }) as Promise<string>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCircleUSD.address,
          abi: fairCircleDeployment.contracts.FairCircleUSD.abi,
          functionName: "symbol",
        }) as Promise<string>,
        client.readContract({
          address: fairCircleDeployment.contracts.FairCircleUSD.address,
          abi: fairCircleDeployment.contracts.FairCircleUSD.abi,
          functionName: "underlying",
        }) as Promise<Address>,
        client.readContract({
          address: fairCircleDeployment.contracts.TestUSD.address,
          abi: fairCircleDeployment.contracts.TestUSD.abi,
          functionName: "name",
        }) as Promise<string>,
        client.readContract({
          address: fairCircleDeployment.contracts.TestUSD.address,
          abi: fairCircleDeployment.contracts.TestUSD.abi,
          functionName: "decimals",
        }) as Promise<number>,
      ]);

      const wiringValid =
        sameAddress(coordinatorCore, fairCircleDeployment.contracts.FairCircle.address) &&
        sameAddress(coordinatorToken, fairCircleDeployment.contracts.FairCircleUSD.address) &&
        sameAddress(underlying, fairCircleDeployment.contracts.TestUSD.address) &&
        testUsdName.length > 0 &&
        testUsdDecimals === 6;
      const bytecodeValid = bytecodeChecks.every((check) => check.exists && check.hashMatches);
      const data: HealthData = {
        nextRoomId: nextRoomId.toString(),
        nextPlanId: nextPlanId.toString(),
        tokenName,
        tokenSymbol,
        fairCircleReachable: bytecodeChecks.find((check) => check.name === "FairCircle")?.hashMatches === true,
        coordinatorReachable: bytecodeChecks.find((check) => check.name === "FairCirclePlanTogether")?.hashMatches === true,
        confidentialTokenReachable: bytecodeChecks.find((check) => check.name === "FairCircleUSD")?.hashMatches === true,
      };

      if (!bytecodeValid || !wiringValid) {
        setState({
          status: "partial",
          data,
          message: "One or more contract bytecode or constructor-wiring checks did not match the deployment manifest.",
          refreshedAt,
        });
        return;
      }

      setState({ status: "healthy", data, refreshedAt });
    } catch (error) {
      const message = safeHealthMessage(error);
      setState({
        status: message.includes("configuration")
          ? "config-invalid"
          : "rpc-unavailable",
        message,
        refreshedAt,
      });
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  return (
    <Card className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-700">
            Live deployment
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
            Ethereum Sepolia health
          </h2>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-950"
        >
          Refresh
        </button>
      </div>

      {state.status === "loading" ? <LoadingState label="Reading Sepolia contracts" /> : null}
      {state.status === "rpc-unavailable" || state.status === "config-invalid" ? (
        <InlineError message={state.message} />
      ) : null}
      {state.status === "partial" ? (
        <InlineError message={state.message} />
      ) : null}
      {"data" in state && state.data ? <HealthDetails data={state.data} status={state.status} /> : null}

      <div className="grid gap-3">
        <ContractAddress
          label="FairCircle"
          address={fairCircleDeployment.contracts.FairCircle.address}
        />
        <ContractAddress
          label="Plan Together coordinator"
          address={fairCircleDeployment.contracts.FairCirclePlanTogether.address}
        />
        <ContractAddress
          label="Confidential token wrapper"
          address={fairCircleDeployment.contracts.FairCircleUSD.address}
        />
        <ContractAddress
          label="TestUSD"
          address={fairCircleDeployment.contracts.TestUSD.address}
        />
      </div>

      <p className="text-xs text-slate-500">
        Network: Ethereum Sepolia. Deployment status: Live. Last refresh:{" "}
        {"refreshedAt" in state && state.refreshedAt ? state.refreshedAt : "not yet refreshed"}.
      </p>
    </Card>
  );
}

function HealthDetails({
  data,
  status,
}: {
  data: HealthData;
  status: "healthy" | "partial";
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <Metric label="FairCircle" ok={data.fairCircleReachable} />
      <Metric label="Coordinator" ok={data.coordinatorReachable} />
      <Metric label={`${data.tokenSymbol || "cFUSD"} wrapper`} ok={data.confidentialTokenReachable} />
      <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
          Counters
        </p>
        <p className="mt-2 text-sm text-slate-700">
          nextRoomId {data.nextRoomId}
        </p>
        <p className="text-sm text-slate-700">nextPlanId {data.nextPlanId}</p>
      </div>
      <div className="md:col-span-2 xl:col-span-4">
        <StatusBadge tone={status === "healthy" ? "success" : "warning"}>
          {status === "healthy" ? "Healthy" : "Partially unavailable"}
        </StatusBadge>
      </div>
    </div>
  );
}

function Metric({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-sm font-medium text-slate-800">
        {ok ? "Reachable" : "Unavailable"}
      </p>
    </div>
  );
}

function assertGeneratedConfig() {
  if (fairCircleDeployment.network.chainId !== 11155111) {
    throw new Error("Frontend contract configuration targets the wrong network.");
  }
  for (const name of coreContracts) {
    getAddress(fairCircleDeployment.contracts[name].address);
  }
  getAddress(fairCircleDeployment.nox.address);
}

function sameAddress(left: Address, right: Address) {
  return left.toLowerCase() === right.toLowerCase();
}

function safeHealthMessage(error: unknown) {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.replace(/https?:\/\/\S+/gi, "[redacted-url]");
  }
  return "Sepolia RPC is unavailable.";
}
