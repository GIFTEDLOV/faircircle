import hre from "hardhat";
import { formatEther } from "viem";
import {
  assertNoxCompute,
  assertSepoliaChain,
  createSepoliaClients,
  deployContract,
  DEPLOYMENT_PATH,
  estimateFullDeploymentCost,
  gitCommitSha,
  loadArtifacts,
  loadSepoliaEnv,
  NETWORK_NAME,
  parseForceFlag,
  runSepoliaScript,
  SEPOLIA_CHAIN_ID,
  sourceVerificationSkipped,
  writeDeploymentManifest,
  type DeploymentManifest,
} from "./sepolia-utils.js";

async function main() {
  loadSepoliaEnv();

  const force = parseForceFlag();
  const { publicClient, walletClient, deployer } = createSepoliaClients();

  console.log(`Network: ${NETWORK_NAME}`);
  await assertSepoliaChain(publicClient);
  console.log(`Chain ID: ${SEPOLIA_CHAIN_ID}`);
  console.log(`Deployer: ${deployer}`);

  const balance = await publicClient.getBalance({ address: deployer });
  console.log(`Deployer balance: ${formatEther(balance)} Sepolia ETH`);

  const nox = await assertNoxCompute(publicClient);
  console.log(`Nox compute bytecode confirmed: ${nox.address}`);

  console.log("Compiling contracts before deployment...");
  await hre.tasks.getTask("compile").run({});

  const artifacts = await loadArtifacts();
  const fullEstimate = await estimateFullDeploymentCost(publicClient, artifacts, deployer);
  console.log(
    `Total buffered deployment cost estimate: ${formatEther(
      fullEstimate.totalBufferedCost,
    )} Sepolia ETH`,
  );
  if (balance < fullEstimate.totalBufferedCost) {
    throw new Error(
      `Deployer balance is below the total buffered deployment cost estimate. Balance: ${formatEther(
        balance,
      )}, required: ${formatEther(fullEstimate.totalBufferedCost)} Sepolia ETH.`,
    );
  }

  const testUsd = await deployContract(
    publicClient,
    walletClient,
    "TestUSD",
    artifacts.TestUSD,
  );
  console.log(`TestUSD deployed: ${testUsd.address}`);

  const fairCircleUsd = await deployContract(
    publicClient,
    walletClient,
    "FairCircleUSD",
    artifacts.FairCircleUSD,
    [testUsd.address],
  );
  console.log(`FairCircleUSD deployed: ${fairCircleUsd.address}`);

  const fairCircle = await deployContract(
    publicClient,
    walletClient,
    "FairCircle",
    artifacts.FairCircle,
  );
  console.log(`FairCircle deployed: ${fairCircle.address}`);

  const planTogether = await deployContract(
    publicClient,
    walletClient,
    "FairCirclePlanTogether",
    artifacts.FairCirclePlanTogether,
    [fairCircle.address, fairCircleUsd.address],
  );
  console.log(`FairCirclePlanTogether deployed: ${planTogether.address}`);

  const cUsd = {
    read: {
      underlying: () =>
        publicClient.readContract({
          address: fairCircleUsd.address,
          abi: artifacts.FairCircleUSD.abi,
          functionName: "underlying",
        }) as Promise<string>,
    },
  };
  const coordinator = {
    read: {
      fairCircleCore: () =>
        publicClient.readContract({
          address: planTogether.address,
          abi: artifacts.FairCirclePlanTogether.abi,
          functionName: "fairCircleCore",
        }) as Promise<string>,
      approvedConfidentialToken: () =>
        publicClient.readContract({
          address: planTogether.address,
          abi: artifacts.FairCirclePlanTogether.abi,
          functionName: "approvedConfidentialToken",
        }) as Promise<string>,
    },
  };

  const underlying = await cUsd.read.underlying();
  if (underlying.toLowerCase() !== testUsd.address.toLowerCase()) {
    throw new Error("FairCircleUSD underlying token wiring check failed.");
  }

  const core = await coordinator.read.fairCircleCore();
  if (core.toLowerCase() !== fairCircle.address.toLowerCase()) {
    throw new Error("Plan Together core wiring check failed.");
  }

  const approvedToken = await coordinator.read.approvedConfidentialToken();
  if (approvedToken.toLowerCase() !== fairCircleUsd.address.toLowerCase()) {
    throw new Error("Plan Together approved token wiring check failed.");
  }

  const manifest: DeploymentManifest = {
    schemaVersion: 1,
    network: {
      name: NETWORK_NAME,
      chainId: SEPOLIA_CHAIN_ID,
    },
    deployer,
    gitCommit: await gitCommitSha(),
    timestamp: new Date().toISOString(),
    nox,
    contracts: {
      TestUSD: {
        address: testUsd.address,
        constructorArgs: [],
        transactionHash: testUsd.transactionHash,
        blockNumber: testUsd.blockNumber.toString(),
        gasUsed: testUsd.gasUsed.toString(),
        runtimeBytecodeHash: testUsd.runtimeBytecodeHash,
      },
      FairCircleUSD: {
        address: fairCircleUsd.address,
        constructorArgs: [testUsd.address],
        transactionHash: fairCircleUsd.transactionHash,
        blockNumber: fairCircleUsd.blockNumber.toString(),
        gasUsed: fairCircleUsd.gasUsed.toString(),
        runtimeBytecodeHash: fairCircleUsd.runtimeBytecodeHash,
      },
      FairCircle: {
        address: fairCircle.address,
        constructorArgs: [],
        transactionHash: fairCircle.transactionHash,
        blockNumber: fairCircle.blockNumber.toString(),
        gasUsed: fairCircle.gasUsed.toString(),
        runtimeBytecodeHash: fairCircle.runtimeBytecodeHash,
      },
      FairCirclePlanTogether: {
        address: planTogether.address,
        constructorArgs: [fairCircle.address, fairCircleUsd.address],
        transactionHash: planTogether.transactionHash,
        blockNumber: planTogether.blockNumber.toString(),
        gasUsed: planTogether.gasUsed.toString(),
        runtimeBytecodeHash: planTogether.runtimeBytecodeHash,
      },
    },
    sourceVerification: process.env.ETHERSCAN_API_KEY
      ? sourceVerificationSkipped("Run pnpm verify:sepolia to submit source verification.")
      : sourceVerificationSkipped("ETHERSCAN_API_KEY is not set."),
  };

  await writeDeploymentManifest(manifest, force);
  console.log(`Deployment manifest written: ${DEPLOYMENT_PATH}`);
  console.log("Constructor wiring checks passed.");
}

await runSepoliaScript(main);
