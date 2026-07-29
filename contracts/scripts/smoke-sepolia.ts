import assert from "node:assert/strict";
import { createViemHandleClient } from "@iexec-nox/handle";
import { NOX_COMPUTE_ADDRESS } from "@iexec-nox/nox-hardhat-plugin";
import {
  parseEventLogs,
  type Abi,
  type Address,
  type Hex,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  assertDistinctAddresses,
  assertSepoliaChain,
  createSepoliaClients,
  loadArtifacts,
  loadSepoliaEnv,
  normalizePrivateKey,
  oneHourFromNow,
  optionalEnv,
  readDeploymentManifest,
  runSepoliaScript,
  waitForSuccessfulReceipt,
} from "./sepolia-utils.js";

const RoomMode = {
  QuietBudget: 0,
} as const;

async function main() {
  loadSepoliaEnv();
  const gatewayUrl = requiredOptional("NOX_HANDLE_GATEWAY_URL");
  const subgraphUrl = requiredOptional("NOX_SUBGRAPH_URL");

  const { publicClient, walletClient, deployer } = createSepoliaClients();
  const smokeMember = readDistinctSmokeMember(deployer);
  assertDistinctAddresses({ deployer, smokeMember });

  const manifest = await readDeploymentManifest();
  const artifacts = await loadArtifacts();
  await assertSepoliaChain(publicClient);

  const testUsd = manifest.contracts.TestUSD.address;
  const cUsd = manifest.contracts.FairCircleUSD.address;
  const fairCircle = manifest.contracts.FairCircle.address;

  console.log(`Smoke deployer: ${deployer}`);
  console.log(`Smoke second member: ${smokeMember}`);

  const metadata = await Promise.all([
    publicClient.readContract({
      address: testUsd,
      abi: artifacts.TestUSD.abi,
      functionName: "name",
    }),
    publicClient.readContract({
      address: cUsd,
      abi: artifacts.FairCircleUSD.abi,
      functionName: "symbol",
    }),
    publicClient.readContract({
      address: fairCircle,
      abi: artifacts.FairCircle.abi,
      functionName: "nextRoomId",
    }),
  ]);
  console.log(`Metadata: ${metadata.map(String).join(", ")}`);

  const handleClient = await createViemHandleClient(scopedWallet(walletClient), {
    smartContractAddress: NOX_COMPUTE_ADDRESS,
    gatewayUrl,
    subgraphUrl,
  });

  const amount = 10n;
  const mintHash = await walletClient.writeContract({
    address: testUsd,
    abi: artifacts.TestUSD.abi,
    functionName: "mint",
    args: [deployer, amount],
  });
  await waitForSuccessfulReceipt(publicClient, mintHash, "mint tFUSD");

  const approveHash = await walletClient.writeContract({
    address: testUsd,
    abi: artifacts.TestUSD.abi,
    functionName: "approve",
    args: [cUsd, amount],
  });
  await waitForSuccessfulReceipt(publicClient, approveHash, "approve cFUSD wrapper");

  const wrapHash = await walletClient.writeContract({
    address: cUsd,
    abi: artifacts.FairCircleUSD.abi,
    functionName: "wrap",
    args: [deployer, amount],
  });
  await waitForSuccessfulReceipt(publicClient, wrapHash, "wrap cFUSD");

  const balanceHandle = (await publicClient.readContract({
    address: cUsd,
    abi: artifacts.FairCircleUSD.abi,
    functionName: "confidentialBalanceOf",
    args: [deployer],
  })) as Hex;
  assert.notEqual(balanceHandle, zeroHandle(), "confidential balance handle exists");
  const decryptedBalance = await handleClient.decrypt(balanceHandle);
  assert.equal(decryptedBalance.value, amount);

  const roomId = (await publicClient.readContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "nextRoomId",
  })) as bigint;
  const createRoomHash = await walletClient.writeContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "createQuietBudgetRoom",
    args: [
      "Sepolia smoke budget",
      [deployer, smokeMember],
      [5n],
      oneHourFromNow(),
      RoomMode.QuietBudget,
    ],
  });
  const createRoomReceipt = await waitForSuccessfulReceipt(
    publicClient,
    createRoomHash,
    "create smoke QuietBudget room",
  );

  const encryptedCapacity = await handleClient.encryptInput(
    5n,
    "uint256",
    fairCircle,
  );
  const submitHash = await walletClient.writeContract({
    address: fairCircle,
    abi: artifacts.FairCircle.abi,
    functionName: "submitPrivateCapacity",
    args: [roomId, encryptedCapacity.handle, encryptedCapacity.handleProof],
  });
  const submitReceipt = await waitForSuccessfulReceipt(
    publicClient,
    submitHash,
    "submit smoke capacity",
  );

  const roomEvents = parseEventLogs({
    abi: artifacts.FairCircle.abi as Abi,
    eventName: "RoomCreated",
    logs: createRoomReceipt.logs,
  });
  const capacityEvents = parseEventLogs({
    abi: artifacts.FairCircle.abi as Abi,
    eventName: "CapacitySubmitted",
    logs: submitReceipt.logs,
  });
  assert.equal(roomEvents.length, 1, "RoomCreated event emitted");
  assert.equal(capacityEvents.length, 1, "CapacitySubmitted event emitted");

  console.log("Sepolia smoke test passed.");
  console.log(`mint: ${mintHash}`);
  console.log(`approve: ${approveHash}`);
  console.log(`wrap: ${wrapHash}`);
  console.log(`create smoke room: ${createRoomHash}`);
  console.log(`submit smoke capacity: ${submitHash}`);
}

function readDistinctSmokeMember(deployer: Address): Address {
  const actorKeys = [
    "SEPOLIA_ACTOR_1_PRIVATE_KEY",
    "SEPOLIA_ACTOR_2_PRIVATE_KEY",
    "SEPOLIA_ACTOR_3_PRIVATE_KEY",
    "SEPOLIA_RECIPIENT_PRIVATE_KEY",
  ];
  for (const keyName of actorKeys) {
    const value = optionalEnv(keyName);
    if (value === undefined) {
      continue;
    }
    const address = privateKeyToAccount(normalizePrivateKey(value)).address;
    if (address.toLowerCase() !== deployer.toLowerCase()) {
      return address;
    }
  }
  throw new Error(
    "Smoke test needs one actor private key distinct from DEPLOYER_PRIVATE_KEY to create a valid two-member budget room.",
  );
}

function requiredOptional(name: string) {
  const value = optionalEnv(name);
  if (value === undefined) {
    throw new Error(`${name} is required for live Nox handle operations.`);
  }
  return value;
}

function zeroHandle() {
  return `0x${"0".repeat(64)}` as Hex;
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

await runSepoliaScript(main);
