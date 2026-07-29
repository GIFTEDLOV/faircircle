import hre from "hardhat";
import { verifyContract } from "@nomicfoundation/hardhat-verify/verify";
import { keccak256, type Address } from "viem";
import {
  assertDistinctAddresses,
  assertReceiptSuccess,
  assertRuntimeCode,
  assertSepoliaChain,
  CONTRACT_NAMES,
  createSepoliaPublicClient,
  deploymentContractPath,
  DEPLOYMENT_PATH,
  loadArtifacts,
  loadSepoliaEnv,
  NETWORK_NAME,
  optionalEnv,
  readDeploymentManifest,
  runSepoliaScript,
  SEPOLIA_CHAIN_ID,
  sourceVerificationSkipped,
  writeJsonAtomic,
  type ContractName,
  type DeploymentManifest,
  type SourceVerificationStatus,
} from "./sepolia-utils.js";

async function main() {
  loadSepoliaEnv();

  const manifest = await readDeploymentManifest();
  const publicClient = createSepoliaPublicClient();
  const artifacts = await loadArtifacts();

  await assertSepoliaChain(publicClient);
  assertManifestNetwork(manifest);
  assertManifestGitSha(manifest);

  assertDistinctAddresses(
    Object.fromEntries(
      CONTRACT_NAMES.map((name) => [name, manifest.contracts[name].address]),
    ) as Record<ContractName, Address>,
  );

  for (const name of CONTRACT_NAMES) {
    const entry = manifest.contracts[name];
    const code = await assertRuntimeCode(publicClient, entry.address, name);
    const liveHash = keccak256(code);
    if (liveHash !== entry.runtimeBytecodeHash) {
      throw new Error(`${name} runtime bytecode hash mismatch.`);
    }

    const receipt = await publicClient.getTransactionReceipt({
      hash: entry.transactionHash,
    });
    assertReceiptSuccess(receipt, `${name} deployment`);
    if (receipt.contractAddress?.toLowerCase() !== entry.address.toLowerCase()) {
      throw new Error(`${name} receipt contract address mismatch.`);
    }
    if (receipt.blockNumber.toString() !== entry.blockNumber) {
      throw new Error(`${name} receipt block number mismatch.`);
    }

    const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
    if (block.hash === null) {
      throw new Error(`${name} deployment block is unavailable.`);
    }
  }

  await verifyContractState(manifest, artifacts, publicClient);

  const sourceVerification = await maybeVerifySources(manifest);
  if (sourceVerification.attempted) {
    const updated: DeploymentManifest = {
      ...manifest,
      sourceVerification,
    };
    await writeJsonAtomic(DEPLOYMENT_PATH, updated);
  }

  console.log("Sepolia deployment manifest verified against live chain state.");
  console.log(
    `Source verification: ${sourceVerification.status}${
      sourceVerification.attempted ? "" : ` (${sourceVerification.reason})`
    }`,
  );
}

function assertManifestNetwork(manifest: DeploymentManifest) {
  if (manifest.network.name !== NETWORK_NAME) {
    throw new Error(`Manifest network name mismatch: ${manifest.network.name}`);
  }
  if (manifest.network.chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(`Manifest chain ID mismatch: ${manifest.network.chainId}`);
  }
}

function assertManifestGitSha(manifest: DeploymentManifest) {
  if (!/^[0-9a-f]{40}$/.test(manifest.gitCommit)) {
    throw new Error("Manifest git SHA is missing or invalid.");
  }
}

async function verifyContractState(
  manifest: DeploymentManifest,
  artifacts: Awaited<ReturnType<typeof loadArtifacts>>,
  publicClient: ReturnType<typeof createSepoliaPublicClient>,
) {
  const testUsd = manifest.contracts.TestUSD.address;
  const fairCircleUsd = manifest.contracts.FairCircleUSD.address;
  const fairCircle = manifest.contracts.FairCircle.address;
  const coordinator = manifest.contracts.FairCirclePlanTogether.address;

  const [testName, testSymbol, testDecimals] = await Promise.all([
    publicClient.readContract({
      address: testUsd,
      abi: artifacts.TestUSD.abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address: testUsd,
      abi: artifacts.TestUSD.abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: testUsd,
      abi: artifacts.TestUSD.abi,
      functionName: "decimals",
    }),
  ]);
  assertEqual(testName, "FairCircle Test USD", "TestUSD name");
  assertEqual(testSymbol, "tFUSD", "TestUSD symbol");
  assertEqual(testDecimals, 6, "TestUSD decimals");

  const [confidentialName, confidentialSymbol, underlying] = await Promise.all([
    publicClient.readContract({
      address: fairCircleUsd,
      abi: artifacts.FairCircleUSD.abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address: fairCircleUsd,
      abi: artifacts.FairCircleUSD.abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: fairCircleUsd,
      abi: artifacts.FairCircleUSD.abi,
      functionName: "underlying",
    }),
  ]);
  assertEqual(confidentialName, "Confidential FairCircle USD", "FairCircleUSD name");
  assertEqual(confidentialSymbol, "cFUSD", "FairCircleUSD symbol");
  assertAddressEqual(underlying as Address, testUsd, "FairCircleUSD underlying");

  const [nextRoomId, nextContributionId, minMembers, maxMembers, maxAmount] =
    await Promise.all([
      publicClient.readContract({
        address: fairCircle,
        abi: artifacts.FairCircle.abi,
        functionName: "nextRoomId",
      }),
      publicClient.readContract({
        address: fairCircle,
        abi: artifacts.FairCircle.abi,
        functionName: "nextContributionId",
      }),
      publicClient.readContract({
        address: fairCircle,
        abi: artifacts.FairCircle.abi,
        functionName: "MIN_MEMBERS",
      }),
      publicClient.readContract({
        address: fairCircle,
        abi: artifacts.FairCircle.abi,
        functionName: "MAX_MEMBERS",
      }),
      publicClient.readContract({
        address: fairCircle,
        abi: artifacts.FairCircle.abi,
        functionName: "MAX_SUPPORTED_AMOUNT",
      }),
    ]);
  assertEqual(nextRoomId, 1n, "FairCircle initial nextRoomId");
  assertEqual(nextContributionId, 1n, "FairCircle initial nextContributionId");
  assertEqual(minMembers, 2, "FairCircle MIN_MEMBERS");
  assertEqual(maxMembers, 8, "FairCircle MAX_MEMBERS");
  assertEqual(maxAmount, 10n ** 36n, "FairCircle MAX_SUPPORTED_AMOUNT");

  const [core, approvedToken, nextPlanId] = await Promise.all([
    publicClient.readContract({
      address: coordinator,
      abi: artifacts.FairCirclePlanTogether.abi,
      functionName: "fairCircleCore",
    }),
    publicClient.readContract({
      address: coordinator,
      abi: artifacts.FairCirclePlanTogether.abi,
      functionName: "approvedConfidentialToken",
    }),
    publicClient.readContract({
      address: coordinator,
      abi: artifacts.FairCirclePlanTogether.abi,
      functionName: "nextPlanId",
    }),
  ]);
  assertAddressEqual(core as Address, fairCircle, "Plan Together core");
  assertAddressEqual(
    approvedToken as Address,
    fairCircleUsd,
    "Plan Together approved token",
  );
  assertEqual(nextPlanId, 1n, "Plan Together initial nextPlanId");
}

async function maybeVerifySources(
  manifest: DeploymentManifest,
): Promise<SourceVerificationStatus> {
  if (optionalEnv("ETHERSCAN_API_KEY") === undefined) {
    return sourceVerificationSkipped("ETHERSCAN_API_KEY is not set.");
  }

  const results = {} as Record<
    ContractName,
    {
      status: "passed" | "failed";
      message: string;
    }
  >;

  let failed = false;
  for (const name of CONTRACT_NAMES) {
    const entry = manifest.contracts[name];
    try {
      await verifyContract(
        {
          address: entry.address,
          constructorArgs: entry.constructorArgs,
          contract: deploymentContractPath(name),
          provider: "etherscan",
        },
        hre,
      );
      results[name] = {
        status: "passed",
        message: "Explorer confirmed verification or contract was already verified.",
      };
    } catch (error) {
      failed = true;
      results[name] = {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    provider: "etherscan",
    attempted: true,
    status: failed ? "failed" : "passed",
    timestamp: new Date().toISOString(),
    results,
  };
}

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch. Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function assertAddressEqual(actual: Address, expected: Address, label: string) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`${label} mismatch. Expected ${expected}, got ${actual}.`);
  }
}

await runSepoliaScript(main);
