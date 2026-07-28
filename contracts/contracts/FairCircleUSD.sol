// SPDX-License-Identifier: MIT
pragma solidity ^0.8.35;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {
    ERC20ToERC7984WrapperRaw
} from "@iexec-nox/nox-confidential-contracts/contracts/token/extensions/ERC20ToERC7984WrapperRaw.sol";

/// @notice 1:1 confidential wrapper for FairCircle's test USD token.
contract FairCircleUSD is ERC20ToERC7984WrapperRaw {
    constructor(
        IERC20 underlying
    ) ERC20ToERC7984WrapperRaw(
        "Confidential FairCircle USD",
        "cFUSD",
        "",
        underlying
    ) {}
}
