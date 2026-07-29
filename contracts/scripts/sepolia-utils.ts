import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config as loadEnv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  encodeDeployData,
  formatEther,
  getContract,
  http,
  isAddress,
  keccak256,
  parseAbi,
  type Abi,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { NOX_COMPUTE_ADDRESS } from "@iexec-nox/nox-hardhat-plugin";

export const SEPOLIA_CHAIN_ID = 11155111;
export const NETWORK_NAME = "ethereum-sepolia";
export const DEPLOYMENT_PATH = resolve("..", "deployments", "ethereum-sepolia.json");
export const DEPLOYMENT_ARCHIVE_DIR = resolve("..", "deployments", "archive");
export const LIVE_E2E_PATH = resolve(
  "..",
  "deployments",
  "ethereum-sepolia-live-e2e.json",
);

export const CONTRACT_NAMES = [
  "TestUSD",
  "FairCircleUSD",
  "FairCircle",
  "FairCirclePlanTogether",
] as const;

export type ContractName = (typeof CONTRACT_NAMES)[number];

export type SourceVerificationStatus =
  | {
      provider: "etherscan";
      attempted: false;
      status: "skipped";
      reason: string;
      results: Record<string, never>;
    }
  | {
      provider: "etherscan";
      attempted: true;
      status: "passed" | "failed";
      timestamp: string;
      results: Record<
        ContractName,
        {
          status: "passed" | "failed";
          message: string;
        }
      >;
    };

export type ContractDeployment = {
  address: Address;
  constructorArgs: string[];
  transactionHash: Hex;
  blockNumber: string;
  gasUsed: string;
  runtimeBytecodeHash: Hex;
};

export type DeploymentManifest = {
  schemaVersion: 1;
  network: {
    name: typeof NETWORK_NAME;
    chainId: typeof SEPOLIA_CHAIN_ID;
  };
  deployer: Address;
  gitCommit: string;
  timestamp: string;
  nox: {
    computeAddress: Address;
    runtimeBytecodeHash: Hex;
  };
  contracts: Record<ContractName, ContractDeployment>;
  sourceVerification: SourceVerificationStatus;
};

export type Artifact = {
  contractName: string;
  abi: Abi;
  bytecode: Hex;
  deployedBytecode: Hex;
};

export type SepoliaClients = {
  publicClient: PublicClient;
  walletClient: WalletClient;
  deployer: Address;
};

const execFileAsync = promisify(execFile);

export function loadSepoliaEnv() {
  loadEnv({ path: resolve("..", ".env"), quiet: true });
  loadEnv({ path: resolve(".env"), override: true, quiet: true });
}

export function readRequiredEnv(names: string[]) {
  const missing = names.filter((name) => empty(process.env[name]));
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
}

export function optionalEnv(name: string) {
  const value = process.env[name];
  return empty(value) ? undefined : value;
}

export function parseForceFlag() {
  return process.argv.includes("--force");
}

export function createSepoliaClients(): SepoliaClients {
  readRequiredEnv(["SEPOLIA_RPC_URL", "DEPLOYER_PRIVATE_KEY"]);

  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (rpcUrl === undefined) {
    throw new Error("SEPOLIA_RPC_URL is missing.");
  }

  const privateKey = normalizePrivateKey(process.env.DEPLOYER_PRIVATE_KEY);
  const account = privateKeyToAccount(privateKey);
  const transport = http(rpcUrl);

  return {
    publicClient: createPublicClient({ chain: sepolia, transport }),
    walletClient: createWalletClient({ account, chain: sepolia, transport }),
    deployer: account.address,
  };
}

export function createSepoliaPublicClient(): PublicClient {
  readRequiredEnv(["SEPOLIA_RPC_URL"]);
  const rpcUrl = process.env.SEPOLIA_RPC_URL;
  if (rpcUrl === undefined) {
    throw new Error("SEPOLIA_RPC_URL is missing.");
  }

  return createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
}

export async function assertSepoliaChain(publicClient: PublicClient) {
  const chainId = await publicClient.getChainId();
  if (chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error(
      `Connected chain ID ${chainId} is not Ethereum Sepolia (${SEPOLIA_CHAIN_ID}).`,
    );
  }
}

export async function assertNoxCompute(publicClient: PublicClient) {
  const code = await publicClient.getBytecode({ address: NOX_COMPUTE_ADDRESS });
  if (code === undefined || code === "0x") {
    throw new Error(
      `Expected Nox compute contract has no bytecode at ${NOX_COMPUTE_ADDRESS}.`,
    );
  }
  return {
    address: NOX_COMPUTE_ADDRESS,
    runtimeBytecodeHash: keccak256(code),
  };
}

export async function getBalance(publicClient: PublicClient, deployer: Address) {
  return publicClient.getBalance({ address: deployer });
}

export async function estimateDeploymentCost(
  publicClient: PublicClient,
  artifact: Artifact,
  account: Address,
  args: readonly unknown[] = [],
) {
  const data = encodeDeployData({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const gas = await publicClient.estimateGas({ account, data });
  const gasPrice = await publicClient.getGasPrice();
  const estimatedCost = gas * gasPrice;
  const bufferedCost = (estimatedCost * 12n) / 10n;
  return { gas, gasPrice, estimatedCost, bufferedCost };
}

export async function estimateFullDeploymentCost(
  publicClient: PublicClient,
  artifacts: Record<ContractName, Artifact>,
  account: Address,
) {
  const placeholderAddress = account;
  const estimates = {
    TestUSD: await estimateDeploymentCost(publicClient, artifacts.TestUSD, account),
    FairCircleUSD: await estimateDeploymentCost(
      publicClient,
      artifacts.FairCircleUSD,
      account,
      [placeholderAddress],
    ),
    FairCircle: await estimateDeploymentCost(publicClient, artifacts.FairCircle, account),
    FairCirclePlanTogether: await estimateDeploymentCost(
      publicClient,
      artifacts.FairCirclePlanTogether,
      account,
      [placeholderAddress, placeholderAddress],
    ),
  } satisfies Record<
    ContractName,
    Awaited<ReturnType<typeof estimateDeploymentCost>>
  >;

  const totalBufferedCost = CONTRACT_NAMES.reduce(
    (sum, name) => sum + estimates[name].bufferedCost,
    0n,
  );

  return { estimates, totalBufferedCost };
}

export async function assertSufficientBalance(
  publicClient: PublicClient,
  deployer: Address,
  requiredWei: bigint,
  label: string,
) {
  const balance = await getBalance(publicClient, deployer);
  if (balance < requiredWei) {
    throw new Error(
      `${label} requires about ${formatEther(requiredWei)} Sepolia ETH with buffer; deployer balance is ${formatEther(
        balance,
      )} Sepolia ETH.`,
    );
  }
  return balance;
}

export async function deployContract(
  publicClient: PublicClient,
  walletClient: WalletClient,
  name: ContractName,
  artifact: Artifact,
  args: readonly unknown[] = [],
) {
  if (walletClient.account === undefined) {
    throw new Error("Wallet client has no deployer account.");
  }

  const estimate = await estimateDeploymentCost(
    publicClient,
    artifact,
    walletClient.account.address,
    args,
  );
  await assertSufficientBalance(
    publicClient,
    walletClient.account.address,
    estimate.bufferedCost,
    `${name} deployment`,
  );

  console.log(
    `${name}: estimated ${estimate.gas.toString()} gas, buffered cost ${formatEther(
      estimate.bufferedCost,
    )} Sepolia ETH`,
  );

  const hash = await walletClient.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode,
    args,
  });
  const receipt = await waitForSuccessfulReceipt(publicClient, hash, name);
  const address = receipt.contractAddress;
  if (address === null || !isAddress(address)) {
    throw new Error(`${name} deployment receipt did not include a contract address.`);
  }
  const code = await assertRuntimeCode(publicClient, address, name);

  return {
    address,
    transactionHash: hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    runtimeBytecodeHash: keccak256(code),
  };
}

export async function waitForSuccessfulReceipt(
  publicClient: PublicClient,
  hash: Hex,
  label: string,
) {
  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    confirmations: 2,
  });
  assertReceiptSuccess(receipt, label);
  return receipt;
}

export function assertReceiptSuccess(receipt: TransactionReceipt, label: string) {
  if (receipt.status !== "success") {
    throw new Error(`${label} transaction ${receipt.transactionHash} failed.`);
  }
}

export async function assertRuntimeCode(
  publicClient: PublicClient,
  address: Address,
  label: string,
) {
  if (address === "0x0000000000000000000000000000000000000000") {
    throw new Error(`${label} address is zero.`);
  }
  const code = await publicClient.getBytecode({ address });
  if (code === undefined || code === "0x") {
    throw new Error(`${label} has no runtime bytecode at ${address}.`);
  }
  return code;
}

export async function loadArtifact(name: ContractName): Promise<Artifact> {
  const artifactPath = resolve(
    "artifacts",
    "contracts",
    contractSourceFile(name),
    `${name}.json`,
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
  if (artifact.contractName !== name) {
    throw new Error(`Artifact mismatch for ${name}: ${artifact.contractName}`);
  }
  return artifact;
}

export async function loadArtifacts() {
  const entries = await Promise.all(
    CONTRACT_NAMES.map(async (name) => [name, await loadArtifact(name)] as const),
  );
  return Object.fromEntries(entries) as Record<ContractName, Artifact>;
}

export async function gitCommitSha() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: resolve(".."),
      windowsHide: true,
    });
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

export async function writeJsonAtomic(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
  await rename(tempPath, path);
}

export async function writeDeploymentManifest(
  manifest: DeploymentManifest,
  force: boolean,
) {
  if (existsSync(DEPLOYMENT_PATH)) {
    if (!force) {
      throw new Error(
        `${DEPLOYMENT_PATH} already exists. Re-run with --force to archive and replace it.`,
      );
    }
    await mkdir(DEPLOYMENT_ARCHIVE_DIR, { recursive: true });
    const archivePath = resolve(
      DEPLOYMENT_ARCHIVE_DIR,
      `ethereum-sepolia-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
    await copyFile(DEPLOYMENT_PATH, archivePath);
    console.log(`Archived previous manifest to ${archivePath}`);
  }

  await writeJsonAtomic(DEPLOYMENT_PATH, manifest);
}

export async function readDeploymentManifest() {
  if (!existsSync(DEPLOYMENT_PATH)) {
    throw new Error(
      `${DEPLOYMENT_PATH} does not exist. Run pnpm deploy:sepolia after credentials are configured.`,
    );
  }
  return JSON.parse(await readFile(DEPLOYMENT_PATH, "utf8")) as DeploymentManifest;
}

export function sourceVerificationSkipped(reason: string): SourceVerificationStatus {
  return {
    provider: "etherscan",
    attempted: false,
    status: "skipped",
    reason,
    results: {},
  };
}

export function contractSourceFile(name: ContractName) {
  return name === "FairCirclePlanTogether"
    ? "FairCirclePlanTogether.sol"
    : `${name}.sol`;
}

export function deploymentContractPath(name: ContractName) {
  return `contracts/${contractSourceFile(name)}:${name}`;
}

export function getTestUsd(publicClient: PublicClient, address: Address, abi: Abi) {
  return getContract({ address, abi, client: publicClient });
}

export function requireAddress(value: string | undefined, label: string): Address {
  if (value === undefined || !isAddress(value)) {
    throw new Error(`${label} is not a valid address.`);
  }
  return value;
}

export function assertDistinctAddresses(addresses: Record<string, Address>) {
  const seen = new Map<string, string>();
  for (const [label, address] of Object.entries(addresses)) {
    const normalized = address.toLowerCase();
    const existing = seen.get(normalized);
    if (existing !== undefined) {
      throw new Error(`${label} and ${existing} both use ${address}; addresses must be distinct.`);
    }
    seen.set(normalized, label);
  }
}

export function normalizePrivateKey(value: string | undefined): Hex {
  if (empty(value)) {
    throw new Error("Private key value is missing.");
  }
  const prefixed = value.startsWith("0x") ? value : `0x${value}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(prefixed)) {
    throw new Error("Private key is not a valid 32-byte hex value.");
  }
  return prefixed as Hex;
}

export function oneHourFromNow() {
  return BigInt(Math.floor(Date.now() / 1000) + 3600);
}

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
  "function mint(address,uint256)",
]);

export async function runSepoliaScript(main: () => Promise<void>) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function empty(value: string | undefined) {
  return value === undefined || value.trim() === "";
}
