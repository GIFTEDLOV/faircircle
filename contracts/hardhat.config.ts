import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import noxPlugin from "@iexec-nox/nox-hardhat-plugin";
import { config as loadEnv } from "dotenv";
import { defineConfig } from "hardhat/config";

loadEnv({ path: "../.env", quiet: true });
loadEnv({ path: ".env", override: true, quiet: true });

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, noxPlugin],
  solidity: {
    version: "0.8.35",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    default: {
      type: "edr-simulated",
      chainType: "op",
      allowUnlimitedContractSize: true,
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      chainId: 11155111,
      url: process.env.SEPOLIA_RPC_URL ?? "http://127.0.0.1:8545",
      accounts: "remote",
    },
  },
  verify: {
    etherscan: process.env.ETHERSCAN_API_KEY
      ? {
          apiKey: process.env.ETHERSCAN_API_KEY,
        }
      : {
          enabled: false,
        },
  },
});
