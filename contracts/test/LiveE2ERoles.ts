import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createWalletClient, http, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  requireAccount,
  resolveLiveE2ERoles,
} from "../scripts/live-e2e-roles.js";
import { normalizePrivateKey } from "../scripts/sepolia-utils.js";

const rpcUrl = "http://127.0.0.1:8545";
const keys = {
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  actor1: "0x59c6995e998f97a5a0044966f094538a7e362cbffa8bb516820f5217d6d36b90",
  actor2: "0x5de4111afa1a4b4f4f2a1fdbd5b305214a3a6fbaba9bae7b388d18b6b3a6e1b7",
  actor3: "0x7c8521182946d4779ac33189b01a7edfa7a21729b811a1aa17361998f9cb1126",
  recipient: "0x47e179ec1974886d1d4d30b6e6af247e7dfe6d1d8f77e056818af6cc062636d2",
} as const;

describe("live Sepolia E2E role resolution", () => {
  it("uses actor 3 as recipient when no dedicated recipient key is set", () => {
    const roles = resolveRoles();

    assert.equal(roles.recipientMode, "actor3");
    assert.equal(
      roles.recipient.toLowerCase(),
      roles.actorAddresses[2].toLowerCase(),
    );
    assert.equal(roles.walletsForBalanceChecks.length, 4);
    assert.equal(roles.walletsForHandleClients.length, 4);
  });

  it("supports a dedicated recipient key when one is set", () => {
    const roles = resolveRoles(keys.recipient);

    assert.equal(roles.recipientMode, "dedicated");
    assert.notEqual(
      roles.recipient.toLowerCase(),
      roles.actorAddresses[2].toLowerCase(),
    );
    assert.equal(roles.walletsForBalanceChecks.length, 5);
    assert.equal(roles.walletsForHandleClients.length, 5);
  });

  it("deduplicates checks when a supplied recipient key equals actor 3", () => {
    const roles = resolveRoles(keys.actor3);

    assert.equal(roles.recipientMode, "dedicated");
    assert.equal(
      roles.recipient.toLowerCase(),
      roles.actorAddresses[2].toLowerCase(),
    );
    assert.equal(roles.walletsForBalanceChecks.length, 4);
    assert.equal(roles.walletsForHandleClients.length, 4);
  });

  it("rejects reuse of deployer or other actors outside the actor 3 recipient case", () => {
    assert.throws(() => resolveRoles(keys.actor1), /recipient and actor1 both use/i);
    assert.throws(
      () =>
        resolveLiveE2ERoles({
          deployer: requireAccount(wallet(keys.deployer)),
          deployerWallet: wallet(keys.deployer),
          rpcUrl,
          actorPrivateKeys: [keys.actor1, keys.actor2, keys.deployer],
        }),
      /actor3 and deployer both use/i,
    );
  });
});

function resolveRoles(recipientPrivateKey?: string) {
  const deployerWallet = wallet(keys.deployer);
  return resolveLiveE2ERoles({
    deployer: requireAccount(deployerWallet),
    deployerWallet,
    rpcUrl,
    actorPrivateKeys: [keys.actor1, keys.actor2, keys.actor3],
    recipientPrivateKey,
  });
}

function wallet(privateKey: string): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(normalizePrivateKey(privateKey)),
    chain: sepolia,
    transport: http(rpcUrl),
  });
}
