import { readFile } from "node:fs/promises";
import type { Hex } from "viem";

const EIP_170_LIMIT = 24_576;

const CONTRACTS = [
  {
    name: "FairCircle",
    artifact: "../artifacts/contracts/FairCircle.sol/FairCircle.json",
  },
  {
    name: "FairCirclePlanTogether",
    artifact:
      "../artifacts/contracts/FairCirclePlanTogether.sol/FairCirclePlanTogether.json",
  },
  {
    name: "FairCircleUSD",
    artifact: "../artifacts/contracts/FairCircleUSD.sol/FairCircleUSD.json",
  },
  {
    name: "TestUSD",
    artifact: "../artifacts/contracts/TestUSD.sol/TestUSD.json",
  },
] as const;

type Artifact = {
  bytecode: Hex;
  deployedBytecode: Hex;
};

let failed = false;

console.log("Production contract size check");
console.log(`EIP-170 runtime limit: ${EIP_170_LIMIT.toLocaleString()} bytes`);

for (const contract of CONTRACTS) {
  const artifact = JSON.parse(
    await readFile(new URL(contract.artifact, import.meta.url), "utf8"),
  ) as Artifact;

  const creationSize = byteLength(artifact.bytecode);
  const runtimeSize = byteLength(artifact.deployedBytecode);
  const headroom = EIP_170_LIMIT - runtimeSize;
  const runtimePercent = (runtimeSize / EIP_170_LIMIT) * 100;

  console.log("");
  console.log(contract.name);
  console.log(`Creation bytecode: ${creationSize.toLocaleString()} bytes`);
  console.log(`Runtime bytecode: ${runtimeSize.toLocaleString()} bytes`);
  console.log(`EIP-170 headroom: ${headroom.toLocaleString()} bytes`);
  console.log(`Runtime usage: ${runtimePercent.toFixed(2)}%`);

  if (runtimeSize > EIP_170_LIMIT) {
    console.error(`${contract.name} runtime bytecode exceeds EIP-170.`);
    failed = true;
  }
}

if (failed) {
  process.exitCode = 1;
}

function byteLength(hex: Hex) {
  return (hex.length - 2) / 2;
}
