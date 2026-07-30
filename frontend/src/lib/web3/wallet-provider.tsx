"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Address } from "viem";
import {
  injectedProvider,
  SEPOLIA_CHAIN_HEX,
  SEPOLIA_CHAIN_ID,
  type FairCircleEthereumProvider,
} from "./clients";

export type WalletStatus =
  | "hydrating"
  | "wallet-missing"
  | "disconnected"
  | "connecting"
  | "connected"
  | "wrong-network"
  | "error";

export type WalletContextValue = {
  status: WalletStatus;
  address?: Address;
  chainId?: number;
  error?: string;
  provider?: FairCircleEthereumProvider;
  isSepolia: boolean;
  isConnected: boolean;
  connect: () => Promise<void>;
  reconnect: () => Promise<void>;
  disconnect: () => void;
  switchToSepolia: () => Promise<void>;
};

export const WalletContext = createContext<WalletContextValue | undefined>(undefined);

type WalletProviderProps = {
  children: ReactNode;
};

export function WalletProvider({ children }: WalletProviderProps) {
  const [provider, setProvider] = useState<FairCircleEthereumProvider>();
  const [status, setStatus] = useState<WalletStatus>("hydrating");
  const [address, setAddress] = useState<Address>();
  const [chainId, setChainId] = useState<number>();
  const [error, setError] = useState<string>();
  const [locallyDisconnected, setLocallyDisconnected] = useState(false);

  const applyWalletState = useCallback(
    (nextAddress: Address | undefined, nextChainId: number | undefined) => {
      setAddress(nextAddress);
      setChainId(nextChainId);
      if (nextAddress === undefined) {
        setStatus(
          provider === undefined && injectedProvider() === undefined
            ? "wallet-missing"
            : "disconnected",
        );
        return;
      }
      setStatus(nextChainId === SEPOLIA_CHAIN_ID ? "connected" : "wrong-network");
    },
    [provider],
  );

  const readChainId = useCallback(async (wallet: FairCircleEthereumProvider) => {
    const value = await wallet.request({ method: "eth_chainId" });
    if (typeof value !== "string") {
      throw new Error("Wallet returned an invalid chain ID.");
    }
    return Number.parseInt(value, 16);
  }, []);

  const reconnect = useCallback(async () => {
    const wallet = injectedProvider();
    setProvider(wallet);
    setError(undefined);
    if (wallet === undefined) {
      applyWalletState(undefined, undefined);
      return;
    }
    const [accountsValue, walletChainId] = await Promise.all([
      wallet.request({ method: "eth_accounts" }),
      readChainId(wallet),
    ]);
    const accounts = Array.isArray(accountsValue) ? accountsValue : [];
    const first = typeof accounts[0] === "string" ? (accounts[0] as Address) : undefined;
    applyWalletState(locallyDisconnected ? undefined : first, walletChainId);
  }, [applyWalletState, locallyDisconnected, readChainId]);

  const connect = useCallback(async () => {
    const wallet = injectedProvider();
    setProvider(wallet);
    setError(undefined);
    if (wallet === undefined) {
      applyWalletState(undefined, undefined);
      return;
    }
    setStatus("connecting");
    try {
      const [accountsValue, walletChainId] = await Promise.all([
        wallet.request({ method: "eth_requestAccounts" }),
        readChainId(wallet),
      ]);
      const accounts = Array.isArray(accountsValue) ? accountsValue : [];
      const first = typeof accounts[0] === "string" ? (accounts[0] as Address) : undefined;
      setLocallyDisconnected(false);
      applyWalletState(first, walletChainId);
    } catch (connectError) {
      setStatus("error");
      setError(safeWalletMessage(connectError));
    }
  }, [applyWalletState, readChainId]);

  const disconnect = useCallback(() => {
    setLocallyDisconnected(true);
    setAddress(undefined);
    setError(undefined);
    setStatus(provider === undefined ? "wallet-missing" : "disconnected");
  }, [provider]);

  const switchToSepolia = useCallback(async () => {
    const wallet = provider ?? injectedProvider();
    if (wallet === undefined) {
      applyWalletState(undefined, undefined);
      return;
    }
    setStatus("connecting");
    setError(undefined);
    try {
      await wallet.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: SEPOLIA_CHAIN_HEX }],
      });
    } catch (switchError) {
      if (providerErrorCode(switchError) === 4902) {
        await wallet.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: SEPOLIA_CHAIN_HEX,
            chainName: "Ethereum Sepolia",
            nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
            blockExplorerUrls: ["https://sepolia.etherscan.io"],
          }],
        });
      } else {
        setStatus("error");
        setError(safeWalletMessage(switchError));
        return;
      }
    }
    const walletChainId = await readChainId(wallet);
    applyWalletState(address, walletChainId);
  }, [address, applyWalletState, provider, readChainId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void reconnect(), 0);
    return () => window.clearTimeout(timer);
  }, [reconnect]);

  useEffect(() => {
    const wallet = provider;
    if (wallet === undefined) {
      return undefined;
    }

    const handleAccountsChanged = (accountsValue: unknown) => {
      const accounts = Array.isArray(accountsValue) ? accountsValue : [];
      const first = typeof accounts[0] === "string" ? (accounts[0] as Address) : undefined;
      setLocallyDisconnected(false);
      applyWalletState(first, chainId);
    };
    const handleChainChanged = (chainValue: unknown) => {
      const nextChainId = typeof chainValue === "string"
        ? Number.parseInt(chainValue, 16)
        : undefined;
      applyWalletState(address, nextChainId);
    };

    wallet.on?.("accountsChanged", handleAccountsChanged);
    wallet.on?.("chainChanged", handleChainChanged);
    return () => {
      wallet.removeListener?.("accountsChanged", handleAccountsChanged);
      wallet.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [address, applyWalletState, chainId, provider]);

  const value = useMemo<WalletContextValue>(() => ({
    status,
    address,
    chainId,
    error,
    provider,
    isSepolia: chainId === SEPOLIA_CHAIN_ID,
    isConnected: status === "connected" && address !== undefined,
    connect,
    reconnect,
    disconnect,
    switchToSepolia,
  }), [
    address,
    chainId,
    connect,
    disconnect,
    error,
    provider,
    reconnect,
    status,
    switchToSepolia,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

function providerErrorCode(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error
    ? Number((error as { code: number | string }).code)
    : undefined;
}

function safeWalletMessage(error: unknown) {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message.replace(/https?:\/\/\S+/gi, "[redacted-url]");
  }
  return "Wallet request failed.";
}
