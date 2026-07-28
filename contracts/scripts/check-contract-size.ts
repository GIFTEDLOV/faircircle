import { readFile } from "node:fs/promises";
import { network } from "hardhat";
import type { Abi, Hex } from "viem";

const EIP_170_LIMIT = 24_576;
const WARNING_HEADROOM = 2_048;
const ARTIFACT_PATH = new URL(
  "../artifacts/contracts/FairCircle.sol/FairCircle.json",
  import.meta.url,
);

type Artifact = {
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
};

const artifact = JSON.parse(await readFile(ARTIFACT_PATH, "utf8")) as Artifact;

const creationSize = byteLength(artifact.bytecode);
const runtimeSize = byteLength(artifact.deployedBytecode);
const headroom = EIP_170_LIMIT - runtimeSize;
const runtimePercent = (runtimeSize / EIP_170_LIMIT) * 100;

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const publicClient = await viem.getPublicClient();
const deploymentGas = await publicClient.estimateGas({
  account: deployer.account,
  data: artifact.bytecode,
});

console.log("FairCircle contract size");
console.log(`Creation bytecode: ${creationSize.toLocaleString()} bytes`);
console.log(`Runtime bytecode: ${runtimeSize.toLocaleString()} bytes`);
console.log(`EIP-170 limit: ${EIP_170_LIMIT.toLocaleString()} bytes`);
console.log(`Runtime headroom: ${headroom.toLocaleString()} bytes`);
console.log(`Runtime usage: ${runtimePercent.toFixed(2)}%`);
console.log(`Deployment gas estimate: ${deploymentGas.toLocaleString()}`);

if (runtimeSize > EIP_170_LIMIT) {
  console.error("FairCircle runtime bytecode exceeds the EIP-170 deployment limit.");
  process.exitCode = 1;
} else if (headroom < WARNING_HEADROOM) {
  console.warn(
    "FairCircle is within EIP-170 but has limited headroom; add future modes through a modular architecture.",
  );
}

function byteLength(hex: Hex) {
  return (hex.length - 2) / 2;
}
