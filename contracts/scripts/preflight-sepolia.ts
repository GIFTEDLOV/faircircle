import {
  assertNoxCompute,
  assertSepoliaChain,
  createSepoliaClients,
  estimateFullDeploymentCost,
  getBalance,
  loadArtifacts,
  loadSepoliaEnv,
  NETWORK_NAME,
  runSepoliaScript,
  SEPOLIA_CHAIN_ID,
} from "./sepolia-utils.js";
import { formatEther } from "viem";

async function main() {
  loadSepoliaEnv();

  const { publicClient, deployer } = createSepoliaClients();
  console.log(`Network: ${NETWORK_NAME}`);
  await assertSepoliaChain(publicClient);
  console.log(`Chain ID: ${SEPOLIA_CHAIN_ID}`);
  console.log(`Deployer: ${deployer}`);

  const balance = await getBalance(publicClient, deployer);
  console.log(`Deployer balance: ${formatEther(balance)} Sepolia ETH`);

  const nox = await assertNoxCompute(publicClient);
  console.log(`Nox compute bytecode confirmed: ${nox.address}`);
  console.log(`Nox compute runtime hash: ${nox.runtimeBytecodeHash}`);

  const artifacts = await loadArtifacts();
  const fullEstimate = await estimateFullDeploymentCost(publicClient, artifacts, deployer);
  for (const [name, estimate] of Object.entries(fullEstimate.estimates)) {
    console.log(`${name} estimated gas: ${estimate.gas.toString()}`);
  }
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

  console.log("Sepolia preflight passed. No transactions were broadcast.");
}

await runSepoliaScript(main);
