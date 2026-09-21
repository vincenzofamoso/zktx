// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IRhShieldVerifier {
    function verifyTransaction(
        bytes calldata proof,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32[] calldata nullifiers,
        bytes32[] calldata commitments,
        bytes32 publicDataHash
    ) external view returns (bool);
}
