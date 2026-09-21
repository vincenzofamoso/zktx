// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IRhShieldVerifier} from "./IRhShieldVerifier.sol";

/// @notice Custody and state-transition boundary for PONS-launched ERC-20 assets.
/// @dev The verifier and circuits are security-critical and must be audited before deployment.
contract RhShieldedVault {
    error InvalidProof();
    error InvalidRoot();
    error NullifierAlreadySpent();
    error TransferFailed();
    error ReentrantCall();
    error ZeroValue();

    IRhShieldVerifier public immutable verifier;
    bytes32 public currentRoot;
    uint256 public noteCount;
    mapping(bytes32 => bool) public spentNullifiers;
    mapping(address => uint256) public publicReserves;

    uint256 private unlocked = 1;

    event Deposit(address indexed asset, uint256 amount, bytes32 indexed commitment, uint256 noteIndex);
    event PrivateStateTransition(bytes32 indexed oldRoot, bytes32 indexed newRoot, uint256 nullifierCount, uint256 commitmentCount);
    event Withdrawal(address indexed asset, address indexed recipient, uint256 amount, bytes32 indexed nullifier);

    constructor(IRhShieldVerifier verifier_, bytes32 genesisRoot_) {
        verifier = verifier_;
        currentRoot = genesisRoot_;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    /// @notice Moves a public ERC-20 balance into the shielded note set.
    /// @dev Asset, amount, depositor, commitment, and timing remain public at this boundary.
    function deposit(address asset, uint256 amount, bytes32 commitment) external nonReentrant {
        if (amount == 0 || commitment == bytes32(0)) revert ZeroValue();
        _safeTransferFrom(asset, msg.sender, address(this), amount);
        publicReserves[asset] += amount;
        emit Deposit(asset, amount, commitment, noteCount++);
    }

    /// @notice Applies a private transfer or private in-pool swap proven by the circuit.
    function transact(
        bytes calldata proof,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32[] calldata nullifiers,
        bytes32[] calldata commitments,
        bytes32 publicDataHash
    ) external {
        if (oldRoot != currentRoot || newRoot == bytes32(0)) revert InvalidRoot();
        for (uint256 i; i < nullifiers.length; ++i) {
            if (spentNullifiers[nullifiers[i]]) revert NullifierAlreadySpent();
        }
        if (!verifier.verifyTransaction(proof, oldRoot, newRoot, nullifiers, commitments, publicDataHash)) {
            revert InvalidProof();
        }
        for (uint256 i; i < nullifiers.length; ++i) spentNullifiers[nullifiers[i]] = true;
        currentRoot = newRoot;
        noteCount += commitments.length;
        emit PrivateStateTransition(oldRoot, newRoot, nullifiers.length, commitments.length);
    }

    /// @notice Releases an original token after a proof burns a shielded note.
    /// @dev Asset, amount, recipient, nullifier, and timing are public at this boundary.
    function withdraw(
        bytes calldata proof,
        address asset,
        address recipient,
        uint256 amount,
        bytes32 nullifier,
        bytes32 newRoot
    ) external nonReentrant {
        if (amount == 0 || recipient == address(0)) revert ZeroValue();
        if (spentNullifiers[nullifier]) revert NullifierAlreadySpent();
        bytes32[] memory nullifiers = new bytes32[](1);
        nullifiers[0] = nullifier;
        bytes32[] memory commitments = new bytes32[](0);
        bytes32 publicDataHash = keccak256(abi.encode("WITHDRAW", block.chainid, address(this), asset, recipient, amount));
        if (!verifier.verifyTransaction(proof, currentRoot, newRoot, nullifiers, commitments, publicDataHash)) {
            revert InvalidProof();
        }
        spentNullifiers[nullifier] = true;
        currentRoot = newRoot;
        publicReserves[asset] -= amount;
        _safeTransfer(asset, recipient, amount);
        emit Withdrawal(asset, recipient, amount, nullifier);
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
