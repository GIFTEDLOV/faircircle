import { createWalletClient, http, type Address, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { assertDistinctAddresses, normalizePrivateKey } from "./sepolia-utils.js";

export type RecipientMode = "dedicated" | "actor3";

export type LiveE2ERoles = {
  actors: [WalletClient, WalletClient, WalletClient];
  actorAddresses: [Address, Address, Address];
  recipientWallet: WalletClient;
  recipient: Address;
  recipientMode: RecipientMode;
  walletsForBalanceChecks: WalletClient[];
  walletsForHandleClients: WalletClient[];
};

export type LiveE2ERoleInput = {
  deployer: Address;
  deployerWallet: WalletClient;
  rpcUrl: string;
  actorPrivateKeys: readonly [string, string, string];
  recipientPrivateKey?: string;
};

export function resolveLiveE2ERoles({
  deployer,
  deployerWallet,
  rpcUrl,
  actorPrivateKeys,
  recipientPrivateKey,
}: LiveE2ERoleInput): LiveE2ERoles {
  const actors = actorPrivateKeys.map((privateKey) =>
    walletFromPrivateKey(privateKey, rpcUrl),
  ) as [WalletClient, WalletClient, WalletClient];
  const actorAddresses = actors.map(requireAccount) as [Address, Address, Address];
  assertDistinctAddresses({
    deployer,
    actor1: actorAddresses[0],
    actor2: actorAddresses[1],
    actor3: actorAddresses[2],
  });

  const recipientMode: RecipientMode =
    recipientPrivateKey === undefined ? "actor3" : "dedicated";
  const recipientWallet =
    recipientMode === "actor3"
      ? actors[2]
      : walletFromPrivateKey(recipientPrivateKey, rpcUrl);
  const recipient = requireAccount(recipientWallet);

  if (recipient.toLowerCase() !== actorAddresses[2].toLowerCase()) {
    assertDistinctAddresses({
      deployer,
      actor1: actorAddresses[0],
      actor2: actorAddresses[1],
      actor3: actorAddresses[2],
      recipient,
    });
  } else if (recipientMode === "dedicated") {
    // A supplied recipient key may intentionally match actor 3, but not any other role.
    assertDistinctAddresses({
      deployer,
      actor1: actorAddresses[0],
      actor2: actorAddresses[1],
      actor3: recipient,
    });
  }

  const uniqueWallets = deduplicateWallets([
    deployerWallet,
    ...actors,
    recipientWallet,
  ]);

  return {
    actors,
    actorAddresses,
    recipientWallet,
    recipient,
    recipientMode,
    walletsForBalanceChecks: uniqueWallets,
    walletsForHandleClients: uniqueWallets,
  };
}

export function requireAccount(wallet: WalletClient): Address {
  if (wallet.account === undefined) {
    throw new Error("wallet account is available");
  }
  return wallet.account.address;
}

function walletFromPrivateKey(value: string, rpcUrl: string) {
  return createWalletClient({
    account: privateKeyToAccount(normalizePrivateKey(value)),
    chain: sepolia,
    transport: http(rpcUrl),
  });
}

function deduplicateWallets(wallets: WalletClient[]) {
  const seen = new Set<string>();
  const unique: WalletClient[] = [];
  for (const wallet of wallets) {
    const address = requireAccount(wallet).toLowerCase();
    if (!seen.has(address)) {
      seen.add(address);
      unique.push(wallet);
    }
  }
  return unique;
}
