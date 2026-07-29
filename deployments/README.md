# FairCircle Deployment Artifacts

This directory stores sanitized deployment evidence.

## Files

- `ethereum-sepolia.json`: real Ethereum Sepolia deployment manifest, created by `pnpm deploy:sepolia`.
- `ethereum-sepolia.example.json`: placeholder-only example of the manifest shape.
- `archive/`: previous real manifests archived when `pnpm deploy:sepolia -- --force` replaces a deployment.
- `ethereum-sepolia-live-e2e.json`: result of the optional full multi-wallet live E2E script.

Real manifests must never contain private keys, raw RPC headers, bearer tokens, or `.env` contents. They may contain public deployer addresses, contract addresses, transaction hashes, block numbers, gas used, constructor arguments, runtime bytecode hashes, source-verification status, and git commit SHA.

Temporary deployment files and private wallet material are ignored by git. Sanitized real manifests are not ignored.
