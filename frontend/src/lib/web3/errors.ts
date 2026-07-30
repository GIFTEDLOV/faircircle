export class Web3Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Web3Error";
  }
}

export class WalletNotFoundError extends Web3Error {
  constructor() {
    super("No injected wallet was detected.");
    this.name = "WalletNotFoundError";
  }
}

export class WrongNetworkError extends Web3Error {
  constructor(chainId?: number) {
    super(
      chainId === undefined
        ? "Wallet is not connected to Ethereum Sepolia."
        : `Wallet is connected to chain ${chainId}, not Ethereum Sepolia.`,
    );
    this.name = "WrongNetworkError";
  }
}

export class MissingPublicConfigError extends Web3Error {
  constructor(name: string) {
    super(`${name} is not configured for the browser frontend.`);
    this.name = "MissingPublicConfigError";
  }
}
