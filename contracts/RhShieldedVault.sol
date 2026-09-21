// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDepositVerifier, ITransferVerifier, IWithdrawVerifier} from "./IZkVerifier.sol";

/// @notice Shielded note custody for standard PONS ERC-20 tokens on Robinhood Chain.
/// @dev Verifiers must be generated from the pinned and audited ZKTX circuits.
contract RhShieldedVault {
    uint256 internal constant SNARK_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    error AssetNotSupported();
    error CommitmentAlreadyExists();
    error InvalidProof();
    error InvalidRoot();
    error NullifierAlreadySpent();
    error OnlyOwner();
    error Paused();
    error ReentrantCall();
    error ReserveTooLow();
    error ReserveCapExceeded();
    error TransferFailed();
    error ZeroValue();

    address public owner;
    bool public paused;
    bytes32 public currentRoot;
    uint256 public noteCount;

    IDepositVerifier public immutable depositVerifier;
    ITransferVerifier public immutable transferVerifier;
    IWithdrawVerifier public immutable withdrawVerifier;

    mapping(address => bool) public supportedAssets;
    mapping(address => uint256) public reserveCaps;
    mapping(address => uint256) public publicReserves;
    mapping(bytes32 => bool) public knownCommitments;
    mapping(bytes32 => bool) public knownRoots;
    mapping(bytes32 => bool) public spentNullifiers;

    uint256 private unlocked = 1;

    event AssetSupportChanged(address indexed asset, bool supported);
    event ReserveCapChanged(address indexed asset, uint256 cap);
    event Deposit(
        address indexed asset, uint256 amount, bytes32 indexed commitment, bytes32 newRoot, uint256 noteIndex
    );
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PauseChanged(bool paused);
    event PrivateTransfer(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        bytes32 indexed nullifier,
        bytes32 outputOne,
        bytes32 outputTwo
    );
    event Withdrawal(
        address indexed asset, address indexed recipient, uint256 amount, bytes32 indexed nullifier
    );

    constructor(
        address owner_,
        IDepositVerifier depositVerifier_,
        ITransferVerifier transferVerifier_,
        IWithdrawVerifier withdrawVerifier_,
        bytes32 genesisRoot_
    ) {
        if (
            owner_ == address(0) || address(depositVerifier_) == address(0)
                || address(transferVerifier_) == address(0) || address(withdrawVerifier_) == address(0)
                || genesisRoot_ == bytes32(0) || uint256(genesisRoot_) >= SNARK_FIELD
        ) {
            revert ZeroValue();
        }
        owner = owner_;
        depositVerifier = depositVerifier_;
        transferVerifier = transferVerifier_;
        withdrawVerifier = withdrawVerifier_;
        currentRoot = genesisRoot_;
        knownRoots[genesisRoot_] = true;
        emit OwnershipTransferred(address(0), owner_);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier whenActive() {
        if (paused) revert Paused();
        _;
    }

    modifier nonReentrant() {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        _;
        unlocked = 1;
    }

    function setAssetSupported(address asset, bool supported) external onlyOwner {
        if (asset == address(0)) revert ZeroValue();
        supportedAssets[asset] = supported;
        emit AssetSupportChanged(asset, supported);
    }

    function setReserveCap(address asset, uint256 cap) external onlyOwner {
        if (asset == address(0)) revert ZeroValue();
        reserveCaps[asset] = cap;
        emit ReserveCapChanged(asset, cap);
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        emit PauseChanged(nextPaused);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroValue();
        emit OwnershipTransferred(owner, nextOwner);
        owner = nextOwner;
    }

    /// @dev Signals: roots, commitment, index, asset, amount, chain id, and vault address.
    function deposit(bytes calldata proof, address asset, uint256 amount, bytes32 commitment, bytes32 newRoot)
        external
        nonReentrant
        whenActive
    {
        if (!supportedAssets[asset]) revert AssetNotSupported();
        if (amount == 0 || commitment == bytes32(0)) revert ZeroValue();
        if (reserveCaps[asset] == 0 || publicReserves[asset] + amount > reserveCaps[asset]) {
            revert ReserveCapExceeded();
        }
        if (knownCommitments[commitment]) revert CommitmentAlreadyExists();
        uint256[8] memory signals;
        signals[0] = _field(currentRoot);
        signals[1] = _field(newRoot);
        signals[2] = _field(commitment);
        signals[3] = noteCount;
        signals[4] = uint160(asset);
        signals[5] = amount;
        signals[6] = block.chainid;
        signals[7] = uint160(address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!depositVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        _safeTransferFrom(asset, msg.sender, address(this), amount);
        publicReserves[asset] += amount;
        knownCommitments[commitment] = true;
        currentRoot = newRoot;
        knownRoots[newRoot] = true;
        emit Deposit(asset, amount, commitment, newRoot, noteCount++);
    }

    /// @dev Public signals include roots, nullifier, outputs, insertion indices, chain id, and vault.
    function transact(
        bytes calldata proof,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32 nullifier,
        bytes32 outputOne,
        bytes32 outputTwo
    ) external whenActive {
        if (oldRoot != currentRoot || newRoot == bytes32(0)) revert InvalidRoot();
        if (spentNullifiers[nullifier]) revert NullifierAlreadySpent();
        if (knownCommitments[outputOne] || knownCommitments[outputTwo]) revert CommitmentAlreadyExists();

        uint256[9] memory signals;
        signals[0] = _field(oldRoot);
        signals[1] = _field(newRoot);
        signals[2] = _field(nullifier);
        signals[3] = _field(outputOne);
        signals[4] = _field(outputTwo);
        signals[5] = noteCount;
        signals[6] = noteCount + 1;
        signals[7] = block.chainid;
        signals[8] = uint160(address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!transferVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        spentNullifiers[nullifier] = true;
        knownCommitments[outputOne] = true;
        knownCommitments[outputTwo] = true;
        currentRoot = newRoot;
        knownRoots[newRoot] = true;
        noteCount += 2;
        emit PrivateTransfer(oldRoot, newRoot, nullifier, outputOne, outputTwo);
    }

    /// @dev Public signals: root, nullifier, asset, recipient, amount, chain id, vault.
    function withdraw(
        bytes calldata proof,
        bytes32 root,
        address asset,
        address recipient,
        uint256 amount,
        bytes32 nullifier
    ) external nonReentrant whenActive {
        if (!supportedAssets[asset]) revert AssetNotSupported();
        if (!knownRoots[root]) revert InvalidRoot();
        if (amount == 0 || recipient == address(0)) revert ZeroValue();
        if (spentNullifiers[nullifier]) revert NullifierAlreadySpent();
        if (publicReserves[asset] < amount) revert ReserveTooLow();

        uint256[7] memory signals;
        signals[0] = _field(root);
        signals[1] = _field(nullifier);
        signals[2] = uint160(asset);
        signals[3] = uint160(recipient);
        signals[4] = amount;
        signals[5] = block.chainid;
        signals[6] = uint160(address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!withdrawVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        spentNullifiers[nullifier] = true;
        publicReserves[asset] -= amount;
        _safeTransfer(asset, recipient, amount);
        emit Withdrawal(asset, recipient, amount, nullifier);
    }

    function _field(bytes32 value) private pure returns (uint256) {
        uint256 result = uint256(value);
        if (result >= SNARK_FIELD) revert InvalidRoot();
        return result;
    }

    function _decodeProof(bytes calldata proof)
        private
        pure
        returns (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c)
    {
        (a, b, c) = abi.decode(proof, (uint256[2], uint256[2][2], uint256[2]));
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
