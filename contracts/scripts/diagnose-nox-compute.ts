import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { keccak256, type Address } from "viem";
import {
  createSepoliaPublicClient,
  loadSepoliaEnv,
  NETWORK_NAME,
  NOX_COMPUTE_ADDRESSES,
  noxComputeAddressForChain,
  runSepoliaScript,
} from "./sepolia-utils.js";

async function main() {
  loadSepoliaEnv();

  const sdkMapping = await readInstalledSdkMapping();
  for (const [chainIdText, configuredAddress] of Object.entries(
    NOX_COMPUTE_ADDRESSES,
  )) {
    const sdkAddress = sdkMapping[Number(chainIdText)];
    if (sdkAddress === undefined) {
      throw new Error(`Installed Nox.sol does not define chain ID ${chainIdText}.`);
    }
    if (sdkAddress.toLowerCase() !== configuredAddress.toLowerCase()) {
      throw new Error(
        `Nox compute address mismatch for chain ID ${chainIdText}. Installed Nox.sol: ${sdkAddress}; tooling: ${configuredAddress}.`,
      );
    }
    console.log(`chain ${chainIdText}: ${configuredAddress}`);
  }

  const publicClient = createSepoliaPublicClient();
  const chainId = await publicClient.getChainId();
  const address = noxComputeAddressForChain(chainId);
  const code = await publicClient.getBytecode({ address });
  const codeExists = code !== undefined && code !== "0x";
  const bytecodeLength = codeExists ? (code.length - 2) / 2 : 0;

  console.log(`network: ${NETWORK_NAME}`);
  console.log(`connected chain ID: ${chainId}`);
  console.log(`address: ${address}`);
  console.log(`code exists: ${codeExists}`);
  console.log(`bytecode length: ${bytecodeLength}`);
  if (codeExists) {
    console.log(`bytecode hash: ${keccak256(code)}`);
  }
}

async function readInstalledSdkMapping() {
  const source = await readFile(
    resolve(
      "node_modules",
      "@iexec-nox",
      "nox-protocol-contracts",
      "contracts",
      "sdk",
      "Nox.sol",
    ),
    "utf8",
  );

  const mapping: Record<number, Address> = {};
  const pattern =
    /block\.chainid\s*==\s*(\d+)\)\s*\{\s*return\s+(0x[0-9a-fA-F]{40})\s*;/g;
  for (const match of source.matchAll(pattern)) {
    mapping[Number(match[1])] = match[2] as Address;
  }
  return mapping;
}

await runSepoliaScript(main);
