import { network } from "hardhat";

async function main() {
  const connection = await network.connect();
  const piggyBank = await connection.viem.deployContract(
    "ConfidentialPiggyBank",
  );

  console.log(`ConfidentialPiggyBank deployed to ${piggyBank.address}`);
}

await main();
