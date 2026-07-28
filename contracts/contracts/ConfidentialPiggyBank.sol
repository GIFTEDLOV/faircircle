// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {
    Nox,
    euint256,
    externalEuint256
} from "@iexec-nox/nox-protocol-contracts/contracts/sdk/Nox.sol";

contract ConfidentialPiggyBank {
    error NotOwner(address caller);

    address public immutable owner;
    euint256 private encryptedBalance_;

    event Deposited();
    event Withdrawn();

    modifier onlyOwner() {
        if (msg.sender != owner) {
            revert NotOwner(msg.sender);
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        encryptedBalance_ = Nox.toEuint256(0);
        _restoreBalanceAcl();
    }

    function deposit(
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint256) {
        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        encryptedBalance_ = Nox.add(encryptedBalance_, amount);
        _restoreBalanceAcl();

        emit Deposited();
        return encryptedBalance_;
    }

    function withdraw(
        externalEuint256 encryptedAmount,
        bytes calldata inputProof
    ) external onlyOwner returns (euint256) {
        euint256 amount = Nox.fromExternal(encryptedAmount, inputProof);
        encryptedBalance_ = Nox.sub(encryptedBalance_, amount);
        _restoreBalanceAcl();

        emit Withdrawn();
        return encryptedBalance_;
    }

    function encryptedBalance() external view onlyOwner returns (euint256) {
        return encryptedBalance_;
    }

    function isOwnerAllowed() external view returns (bool) {
        return Nox.isAllowed(encryptedBalance_, owner);
    }

    function isContractAllowed() external view returns (bool) {
        return Nox.isAllowed(encryptedBalance_, address(this));
    }

    function _restoreBalanceAcl() private {
        Nox.allowThis(encryptedBalance_);
        Nox.allow(encryptedBalance_, owner);
    }
}
