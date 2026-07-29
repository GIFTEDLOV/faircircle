import assert from "node:assert/strict";
import { resolve } from "node:path";
import { createViemHandleClient } from "@iexec-nox/handle";
import { type Hex, type WalletClient } from "viem";
import {
  resolveLiveE2ERoles,
} from "./live-e2e-roles.js";
import {
  HistoricalEventReader,
  safeErrorMessage,
} from "./rpc-event-reader.js";
import {
  diagnoseRootCause,
  DIAGNOSED_RECOVERY_AMOUNT,
  enumeratePlans,
  enumerateRecipientCollections,
  evaluateHypotheses,
  LIVE_PLAN_TOGETHER_TITLE,
  minBlock,
  reconstructBalanceLineage,
  unwrapStateForRecipient,
} from "./recipient-balance-lineage.js";
import {
  assertRuntimeCode,
  assertSepoliaChain,
  createSepoliaClients,
  loadArtifacts,
  loadSepoliaEnv,
  noxComputeAddressForChain,
  optionalEnv,
  readDeploymentManifest,
  writeJsonAtomic,
} from "./sepolia-utils.js";

const REPORT_PATH = resolve(
  "..",
  "deployments",
  "ethereum-sepolia-recipient-balance-diagnosis.json",
);

async function main() {
  loadSepoliaEnv();

  const manifest = await readDeploymentManifest();
  const artifacts = await loadArtifacts();
  const { publicClient, walletClient: deployerWallet, deployer } =
    createSepoliaClients();
  await assertSepoliaChain(publicClient);

  const chainId = await publicClient.getChainId();
  const snapshotBlock = await publicClient.getBlockNumber();
  const noxComputeAddress = noxComputeAddressForChain(chainId);
  const noxCode = await assertRuntimeCode(
    publicClient,
    noxComputeAddress,
    "Nox compute",
  );

  const roles = resolveLiveE2ERoles({
    deployer,
    deployerWallet,
    rpcUrl: requiredEnv("SEPOLIA_RPC_URL"),
    actorPrivateKeys: [
      requiredEnv("SEPOLIA_ACTOR_1_PRIVATE_KEY"),
      requiredEnv("SEPOLIA_ACTOR_2_PRIVATE_KEY"),
      requiredEnv("SEPOLIA_ACTOR_3_PRIVATE_KEY"),
    ],
    recipientPrivateKey: optionalEnv("SEPOLIA_RECIPIENT_PRIVATE_KEY"),
  });

  const eventReader = new HistoricalEventReader(publicClient, {
    logger: (message) => console.log(message),
  });

  const recipientClient = await createViemHandleClient(
    scopedWallet(roles.recipientWallet),
    {
      smartContractAddress: noxComputeAddress,
      gatewayUrl: requiredEnv("NOX_HANDLE_GATEWAY_URL"),
      subgraphUrl: requiredEnv("NOX_SUBGRAPH_URL"),
    },
  );

  const testUsd = manifest.contracts.TestUSD.address;
  const cUsd = manifest.contracts.FairCircleUSD.address;
  const fairCircle = manifest.contracts.FairCircle.address;
  const coordinator = manifest.contracts.FairCirclePlanTogether.address;
  const fromBlock = minBlock(
    manifest.contracts.TestUSD.blockNumber,
    manifest.contracts.FairCircleUSD.blockNumber,
    manifest.contracts.FairCircle.blockNumber,
    manifest.contracts.FairCirclePlanTogether.blockNumber,
  );

  await Promise.all([
    assertRuntimeCode(publicClient, testUsd, "TestUSD"),
    assertRuntimeCode(publicClient, cUsd, "FairCircleUSD"),
    assertRuntimeCode(publicClient, fairCircle, "FairCircle"),
    assertRuntimeCode(publicClient, coordinator, "FairCirclePlanTogether"),
  ]);

  const balanceHandle = (await publicClient.readContract({
    address: cUsd,
    abi: artifacts.FairCircleUSD.abi,
    functionName: "confidentialBalanceOf",
    args: [roles.recipient],
  })) as Hex;
  const currentRecipientBalance = (await recipientClient.decrypt(balanceHandle))
    .value as bigint;

  const plans = await enumeratePlans({
    publicClient,
    eventReader,
    coordinator,
    abi: artifacts.FairCirclePlanTogether.abi,
    deployer,
    fromBlock,
    toBlock: snapshotBlock,
  });

  const collections = await enumerateRecipientCollections({
    publicClient,
    eventReader,
    fairCircle,
    coordinator,
    abi: artifacts.FairCircle.abi,
    coordinatorAbi: artifacts.FairCirclePlanTogether.abi,
    cUsd,
    recipient: roles.recipient,
    fromBlock,
    toBlock: snapshotBlock,
  });

  const lineage = await reconstructBalanceLineage({
    eventReader,
    recipientClient,
    cUsd,
    fairCircle,
    cUsdAbi: artifacts.FairCircleUSD.abi,
    fairCircleAbi: artifacts.FairCircle.abi,
    recipient: roles.recipient,
    plans,
    collections,
    fromBlock,
    toBlock: snapshotBlock,
  });

  const unwrapState = await unwrapStateForRecipient({
    eventReader,
    recipientClient,
    cUsd,
    abi: artifacts.FairCircleUSD.abi,
    recipient: roles.recipient,
    fromBlock,
    toBlock: snapshotBlock,
  });

  const hypothesisResults = evaluateHypotheses({
    currentRecipientBalance,
    plans,
    collections,
    ledger: lineage.ledger,
    recipient: roles.recipient,
  });
  const diagnosis = diagnoseRootCause({
    currentRecipientBalance,
    plans,
    collections,
    ledger: lineage.ledger,
    unwrapState,
    recipient: roles.recipient,
  });

  await writeJsonAtomic(REPORT_PATH, {
    schemaVersion: 1,
    status: "diagnosed",
    network: manifest.network,
    fixedSnapshotBlock: snapshotBlock.toString(),
    timestamp: new Date().toISOString(),
    deploymentManifest: {
      deployer: manifest.deployer,
      gitCommit: manifest.gitCommit,
      contracts: {
        TestUSD: testUsd,
        FairCircleUSD: cUsd,
        FairCircle: fairCircle,
        FairCirclePlanTogether: coordinator,
      },
      nox: {
        computeAddress: noxComputeAddress,
        bytecodeExists: noxCode !== "0x",
      },
    },
    roleAddresses: {
      deployer,
      actor1: roles.actorAddresses[0],
      actor2: roles.actorAddresses[1],
      actor3: roles.actorAddresses[2],
      recipient: roles.recipient,
    },
    recipientMode: roles.recipientMode,
    currentRecipientCFUSDBalance: currentRecipientBalance.toString(),
    expectedBalance: DIAGNOSED_RECOVERY_AMOUNT.toString(),
    plans,
    livePlanTogetherPlans: plans.filter((plan) => plan.title === LIVE_PLAN_TOGETHER_TITLE),
    recipientCollectionRooms: collections,
    chronologicalBalanceLedger: lineage.ledger,
    balanceLineage: {
      derivedBalance: lineage.derivedBalance.toString(),
      matchesCurrentBalance: lineage.derivedBalance === currentRecipientBalance,
      unavailableAmountEvents: lineage.unavailableAmountEvents,
    },
    unwrapState,
    hypotheses: hypothesisResults,
    provenRootCause: diagnosis.rootCause,
    supportingTransactionHashes: diagnosis.supportingTransactionHashes,
    recommendedSafestRecoveryApproach: diagnosis.recommendedSafestRecoveryApproach,
    proposedRecoveryRequiresTransaction: diagnosis.proposedRecoveryRequiresTransaction,
  });

  console.log("Resolved public role addresses:");
  console.log(`deployer: ${deployer}`);
  console.log(`actor1: ${roles.actorAddresses[0]}`);
  console.log(`actor2: ${roles.actorAddresses[1]}`);
  console.log(`actor3: ${roles.actorAddresses[2]}`);
  console.log(`recipient: ${roles.recipient}`);
  console.log(`recipientMode: ${roles.recipientMode}`);
  console.log(`Recipient cFUSD balance: ${currentRecipientBalance.toString()}`);
  console.log(`Diagnosis report: ${REPORT_PATH}`);
}

function requiredEnv(name: string) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required.`);
  }
  return value;
}

function scopedWallet(wallet: WalletClient) {
  assert.ok(wallet.account, "wallet account is available");
  const account = wallet.account;

  return new Proxy(wallet, {
    get(target, property, receiver) {
      if (property === "account") {
        return account;
      }
      if (property === "getAddresses") {
        return async () => [account.address];
      }
      return Reflect.get(target, property, receiver);
    },
  }) as WalletClient;
}

try {
  await main();
} catch (error) {
  console.error(safeErrorMessage(error));
  process.exitCode = 1;
}
