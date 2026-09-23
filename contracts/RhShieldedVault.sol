// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ICancelOrderVerifier,
    IDepositVerifier,
    IMarketOrderVerifier,
    IMarketSettlementVerifier,
    ISwapVerifier,
    ITransferVerifier,
    IWithdrawVerifier
} from "./IZkVerifier.sol";
import {ISwapAdapter} from "./ISwapAdapter.sol";

/// @notice Shielded note custody for supported standard ERC-20 tokens on Robinhood Chain.
/// @dev Verifiers must be generated from the exact pinned ZKTX circuits.
contract RhShieldedVault {
    uint256 internal constant SNARK_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint256 public constant BPS = 10_000;
    uint256 public constant EXECUTION_FEE_BPS = 50;
    uint256 public constant BUYBACK_FEE_BPS = 100;
    uint256 public constant TOTAL_MARKET_FEE_BPS = EXECUTION_FEE_BPS + BUYBACK_FEE_BPS;
    uint256 public constant MARKET_SETTLEMENT_DELAY = 30 seconds;
    uint8 public constant MIN_MARKET_SLICES = 3;
    uint8 public constant MAX_MARKET_SLICES = 7;
    error AssetNotSupported();
    error CommitmentAlreadyExists();
    error InvalidProof();
    error InvalidRoot();
    error InvalidMarketPair();
    error MarketAlreadyConfigured();
    error MarketNotConfigured();
    error MarketNotReady();
    error MarketOrderClosed();
    error MarketOrderMissing();
    error BuybackAlreadyActive();
    error OnlyFeeRecipient();
    error OnlyKeeper();
    error NullifierAlreadySpent();
    error OnlyOwner();
    error Paused();
    error ReentrantCall();
    error ReserveTooLow();
    error ReserveCapExceeded();
    error SwapExpired();
    error TransferFailed();
    error ZeroValue();

    address public owner;
    bool public paused;
    bytes32 public currentRoot;
    uint256 public noteCount;

    IDepositVerifier public immutable depositVerifier;
    ITransferVerifier public immutable transferVerifier;
    IWithdrawVerifier public immutable withdrawVerifier;
    ISwapVerifier public immutable swapVerifier;
    ICancelOrderVerifier public immutable cancelOrderVerifier;

    IMarketOrderVerifier public marketOrderVerifier;
    IMarketSettlementVerifier public marketSettlementVerifier;
    ISwapAdapter public marketAdapter;
    address public marketQuoteAsset;
    address public zktxToken;
    address public executionFeeRecipient;
    bool public marketConfigured;

    mapping(address => bool) public supportedAssets;
    mapping(address => uint256) public reserveCaps;
    mapping(address => uint256) public publicReserves;
    mapping(bytes32 => bool) public knownCommitments;
    mapping(bytes32 => bool) public knownRoots;
    mapping(bytes32 => bool) public spentNullifiers;
    mapping(address => bool) public marketKeepers;
    mapping(address => uint256) public pendingMarketReserves;
    mapping(address => uint256) public pendingMarketProceeds;
    mapping(address => uint256) public executionFeeBalances;
    uint256 public totalBuybackQuote;
    uint256 public totalZktxBurned;
    uint256 public pendingBuybackQuote;

    struct MarketOrder {
        address assetIn;
        address assetOut;
        uint256 amountIn;
        uint256 minimumAmountOut;
        uint256 executedInput;
        uint256 grossAmountOut;
        uint256 netAmountOut;
        uint256 executionFeeAmount;
        uint256 buybackFeeAmount;
        uint256 zktxBurned;
        bytes32 settlementKey;
        uint64 openedAt;
        uint64 deadline;
        uint64 lastExecutionAt;
        uint64 lastExecutionBlock;
        uint8 sliceCount;
        uint8 slicesExecuted;
        bool settled;
    }

    struct SliceAccounting {
        uint256 grossAmountOut;
        uint256 userAmountOut;
        uint256 executionFee;
        uint256 buybackFee;
        uint256 zktxBurned;
    }

    mapping(bytes32 => MarketOrder) private marketOrders;
    bytes32[] public marketOrderIds;

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
    event PrivateSwap(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        bytes32 indexed makerNullifier,
        bytes32 takerNullifier,
        bytes32 makerOutput,
        bytes32 takerOutput,
        bytes32 changeOutput
    );
    event PrivateOrderCancelled(
        bytes32 indexed oldRoot,
        bytes32 indexed newRoot,
        bytes32 indexed orderNullifier,
        bytes32 refundCommitment
    );
    event MarketConfigured(
        address indexed orderVerifier,
        address indexed settlementVerifier,
        address indexed adapter,
        address quoteAsset,
        address zktxToken,
        address executionFeeRecipient
    );
    event MarketKeeperChanged(address indexed keeper, bool allowed);
    event MarketOrderOpened(
        bytes32 indexed orderId,
        address indexed assetIn,
        address indexed assetOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint256 deadline,
        uint8 sliceCount,
        bytes32 settlementKey
    );
    event MarketSliceExecuted(
        bytes32 indexed orderId,
        uint8 indexed slice,
        uint256 amountIn,
        uint256 grossAmountOut,
        uint256 netAmountOut,
        uint256 executionFee,
        uint256 buybackFee,
        uint256 zktxBurned
    );
    event MarketOrderSettled(
        bytes32 indexed orderId,
        bytes32 indexed outputCommitment,
        bytes32 indexed refundCommitment,
        uint256 netAmountOut,
        uint256 refundAmount,
        bytes32 newRoot
    );
    event ExecutionFeesClaimed(address indexed asset, address indexed recipient, uint256 amount);
    event BuybackQuoteAccrued(uint256 amount, uint256 pendingTotal);
    event BuybackTokenActivated(address indexed token);
    event PendingBuybackExecuted(uint256 quoteAmount, uint256 zktxBurned);

    constructor(
        address owner_,
        IDepositVerifier depositVerifier_,
        ITransferVerifier transferVerifier_,
        IWithdrawVerifier withdrawVerifier_,
        ISwapVerifier swapVerifier_,
        ICancelOrderVerifier cancelOrderVerifier_,
        bytes32 genesisRoot_
    ) {
        if (
            owner_ == address(0) || address(depositVerifier_) == address(0)
                || address(transferVerifier_) == address(0) || address(withdrawVerifier_) == address(0)
                || address(swapVerifier_) == address(0) || address(cancelOrderVerifier_) == address(0)
                || genesisRoot_ == bytes32(0) || uint256(genesisRoot_) >= SNARK_FIELD
        ) {
            revert ZeroValue();
        }
        owner = owner_;
        depositVerifier = depositVerifier_;
        transferVerifier = transferVerifier_;
        withdrawVerifier = withdrawVerifier_;
        swapVerifier = swapVerifier_;
        cancelOrderVerifier = cancelOrderVerifier_;
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

    modifier onlyKeeper() {
        if (!marketKeepers[msg.sender]) revert OnlyKeeper();
        _;
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

    /// @notice Enables public-market execution once. A new vault is required to replace any component.
    function configureMarket(
        IMarketOrderVerifier orderVerifier_,
        IMarketSettlementVerifier settlementVerifier_,
        ISwapAdapter adapter_,
        address quoteAsset_,
        address zktxToken_,
        address feeRecipient_
    ) external onlyOwner {
        if (marketConfigured) revert MarketAlreadyConfigured();
        if (
            address(orderVerifier_) == address(0) || address(settlementVerifier_) == address(0)
                || address(adapter_) == address(0) || quoteAsset_ == address(0) || feeRecipient_ == address(0)
                || (zktxToken_ != address(0) && quoteAsset_ == zktxToken_)
        ) revert ZeroValue();
        marketOrderVerifier = orderVerifier_;
        marketSettlementVerifier = settlementVerifier_;
        marketAdapter = adapter_;
        marketQuoteAsset = quoteAsset_;
        zktxToken = zktxToken_;
        executionFeeRecipient = feeRecipient_;
        marketKeepers[owner] = true;
        marketConfigured = true;
        emit MarketConfigured(
            address(orderVerifier_),
            address(settlementVerifier_),
            address(adapter_),
            quoteAsset_,
            zktxToken_,
            feeRecipient_
        );
        emit MarketKeeperChanged(owner, true);
    }

    /// @notice Permanently enables buyback-and-burn after the real ZKTX token is deployed.
    /// @dev Before activation, the buyback share remains accounted in `pendingBuybackQuote`.
    function activateBuybackToken(address token) external onlyOwner {
        if (!marketConfigured) revert MarketNotConfigured();
        if (zktxToken != address(0)) revert BuybackAlreadyActive();
        if (token == address(0) || token == marketQuoteAsset || token.code.length == 0) revert ZeroValue();
        zktxToken = token;
        emit BuybackTokenActivated(token);
    }

    function setMarketKeeper(address keeper, bool allowed) external onlyOwner {
        if (keeper == address(0)) revert ZeroValue();
        marketKeepers[keeper] = allowed;
        emit MarketKeeperChanged(keeper, allowed);
    }

    /// @dev Signals: roots, commitment, index, asset, amount, chain id, and vault address.
    function deposit(bytes calldata proof, address asset, uint256 amount, bytes32 commitment, bytes32 newRoot)
        external
        nonReentrant
        whenActive
    {
        if (!supportedAssets[asset]) revert AssetNotSupported();
        if (amount == 0 || commitment == bytes32(0)) revert ZeroValue();
        if (reserveCaps[asset] == 0 || _privateExposure(asset) + amount > reserveCaps[asset]) {
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

    /// @dev Settles committed RFQ terms without publishing traders, assets, or amounts.
    function settleSwap(
        bytes calldata proof,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32 makerNullifier,
        bytes32 takerNullifier,
        bytes32 makerOutput,
        bytes32 takerOutput,
        bytes32 changeOutput,
        uint256 deadline
    ) external whenActive {
        if (oldRoot != currentRoot || newRoot == bytes32(0)) revert InvalidRoot();
        if (deadline < block.timestamp) revert SwapExpired();
        if (spentNullifiers[makerNullifier] || spentNullifiers[takerNullifier]) {
            revert NullifierAlreadySpent();
        }
        if (makerNullifier == takerNullifier) revert NullifierAlreadySpent();
        if (knownCommitments[makerOutput] || knownCommitments[takerOutput] || knownCommitments[changeOutput]) revert CommitmentAlreadyExists();

        uint256[13] memory signals;
        signals[0] = _field(oldRoot);
        signals[1] = _field(newRoot);
        signals[2] = _field(makerNullifier);
        signals[3] = _field(takerNullifier);
        signals[4] = _field(makerOutput);
        signals[5] = _field(takerOutput);
        signals[6] = _field(changeOutput);
        signals[7] = noteCount;
        signals[8] = noteCount + 1;
        signals[9] = noteCount + 2;
        signals[10] = block.chainid;
        signals[11] = uint160(address(this));
        signals[12] = deadline;
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!swapVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        spentNullifiers[makerNullifier] = true;
        spentNullifiers[takerNullifier] = true;
        knownCommitments[makerOutput] = true;
        knownCommitments[takerOutput] = true;
        knownCommitments[changeOutput] = true;
        currentRoot = newRoot;
        knownRoots[newRoot] = true;
        noteCount += 3;
        emit PrivateSwap(
            oldRoot, newRoot, makerNullifier, takerNullifier, makerOutput, takerOutput, changeOutput
        );
    }

    /// @notice Consumes a private note and escrows its backing for sliced execution against a PONS pool.
    /// @dev The output owner and blindings are bound inside settlementKey and remain private.
    function openMarketOrder(
        bytes calldata proof,
        bytes32 root,
        address assetIn,
        uint256 amountIn,
        address assetOut,
        uint256 minimumAmountOut,
        bytes32 nullifier,
        bytes32 settlementKey,
        uint256 deadline
    ) external nonReentrant whenActive {
        if (!marketConfigured) revert MarketNotConfigured();
        if (!knownRoots[root]) revert InvalidRoot();
        if (!supportedAssets[assetIn] || !supportedAssets[assetOut]) revert AssetNotSupported();
        if (assetIn == assetOut || (assetIn != marketQuoteAsset && assetOut != marketQuoteAsset)) {
            revert InvalidMarketPair();
        }
        if (
            amountIn == 0 || minimumAmountOut == 0 || settlementKey == bytes32(0)
                || deadline < block.timestamp + MARKET_SETTLEMENT_DELAY
        ) revert ZeroValue();
        if (
            amountIn > type(uint128).max || minimumAmountOut > type(uint128).max
                || deadline > type(uint64).max
        ) {
            revert InvalidProof();
        }
        if (spentNullifiers[nullifier]) revert NullifierAlreadySpent();
        if (publicReserves[assetIn] < amountIn) revert ReserveTooLow();

        uint256[10] memory signals;
        signals[0] = _field(root);
        signals[1] = _field(nullifier);
        signals[2] = uint160(assetIn);
        signals[3] = amountIn;
        signals[4] = uint160(assetOut);
        signals[5] = minimumAmountOut;
        signals[6] = _field(settlementKey);
        signals[7] = deadline;
        signals[8] = block.chainid;
        signals[9] = uint160(address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!marketOrderVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();

        uint8 slices = MIN_MARKET_SLICES
            + uint8(
                uint256(keccak256(abi.encodePacked(block.prevrandao, blockhash(block.number - 1), nullifier)))
                    % (MAX_MARKET_SLICES - MIN_MARKET_SLICES + 1)
            );
        if (amountIn < slices) slices = uint8(amountIn);

        spentNullifiers[nullifier] = true;
        publicReserves[assetIn] -= amountIn;
        pendingMarketReserves[assetIn] += amountIn;
        marketOrders[nullifier] = MarketOrder({
            assetIn: assetIn,
            assetOut: assetOut,
            amountIn: amountIn,
            minimumAmountOut: minimumAmountOut,
            executedInput: 0,
            grossAmountOut: 0,
            netAmountOut: 0,
            executionFeeAmount: 0,
            buybackFeeAmount: 0,
            zktxBurned: 0,
            settlementKey: settlementKey,
            openedAt: uint64(block.timestamp),
            deadline: uint64(deadline),
            lastExecutionAt: 0,
            lastExecutionBlock: 0,
            sliceCount: slices,
            slicesExecuted: 0,
            settled: false
        });
        marketOrderIds.push(nullifier);
        emit MarketOrderOpened(
            nullifier, assetIn, assetOut, amountIn, minimumAmountOut, deadline, slices, settlementKey
        );
    }

    /// @notice Executes the next protocol-sized slice and atomically buys and burns ZKTX.
    /// @param minimumBuybackOut Keeper-provided protection for the independent ZKTX buyback route.
    function executeNextMarketSlice(bytes32 orderId, uint256 minimumBuybackOut)
        external
        nonReentrant
        whenActive
        onlyKeeper
        returns (uint256 sliceAmount, uint256 userAmountOut, uint256 zktxBurned)
    {
        if (!marketConfigured) revert MarketNotConfigured();
        MarketOrder storage order = marketOrders[orderId];
        if (order.amountIn == 0) revert MarketOrderMissing();
        if (order.settled || order.executedInput == order.amountIn) revert MarketOrderClosed();
        if (block.timestamp > order.deadline || block.number <= order.lastExecutionBlock) {
            revert MarketNotReady();
        }

        sliceAmount = nextMarketSliceAmount(orderId);
        uint256 previousExecuted = order.executedInput;
        uint256 nextExecuted = previousExecuted + sliceAmount;
        uint256 requiredSliceOut = _ceilDiv(order.minimumAmountOut * nextExecuted, order.amountIn)
            - _ceilDiv(order.minimumAmountOut * previousExecuted, order.amountIn);

        order.executedInput = nextExecuted;
        order.slicesExecuted += 1;
        order.lastExecutionAt = uint64(block.timestamp);
        order.lastExecutionBlock = uint64(block.number);
        pendingMarketReserves[order.assetIn] -= sliceAmount;

        SliceAccounting memory accounting = order.assetIn == marketQuoteAsset
            ? _executeBuySlice(order, sliceAmount, requiredSliceOut)
            : _executeSellSlice(order, sliceAmount, requiredSliceOut);

        if (
            reserveCaps[order.assetOut] == 0
                || _privateExposure(order.assetOut) + accounting.userAmountOut > reserveCaps[order.assetOut]
        ) revert ReserveCapExceeded();

        if (accounting.buybackFee != 0) {
            if (zktxToken == address(0)) {
                if (minimumBuybackOut != 0) revert ZeroValue();
                pendingBuybackQuote += accounting.buybackFee;
                emit BuybackQuoteAccrued(accounting.buybackFee, pendingBuybackQuote);
            } else {
                if (minimumBuybackOut == 0) revert ZeroValue();
                accounting.zktxBurned = _executeSwap(
                    marketQuoteAsset, zktxToken, accounting.buybackFee, minimumBuybackOut, address(this)
                );
                _burnZktx(accounting.zktxBurned);
            }
        } else if (minimumBuybackOut != 0) {
            revert ZeroValue();
        }

        order.grossAmountOut += accounting.grossAmountOut;
        order.netAmountOut += accounting.userAmountOut;
        order.executionFeeAmount += accounting.executionFee;
        order.buybackFeeAmount += accounting.buybackFee;
        order.zktxBurned += accounting.zktxBurned;
        pendingMarketProceeds[order.assetOut] += accounting.userAmountOut;
        executionFeeBalances[marketQuoteAsset] += accounting.executionFee;
        totalBuybackQuote += accounting.buybackFee;
        totalZktxBurned += accounting.zktxBurned;
        userAmountOut = accounting.userAmountOut;
        zktxBurned = accounting.zktxBurned;

        emit MarketSliceExecuted(
            orderId,
            order.slicesExecuted,
            sliceAmount,
            accounting.grossAmountOut,
            accounting.userAmountOut,
            accounting.executionFee,
            accounting.buybackFee,
            accounting.zktxBurned
        );
    }

    /// @notice Converts quote accumulated during pre-token testing into ZKTX and burns it.
    function executePendingBuyback(uint256 quoteAmount, uint256 minimumBuybackOut)
        external
        nonReentrant
        whenActive
        onlyKeeper
        returns (uint256 zktxBurned)
    {
        if (zktxToken == address(0)) revert MarketNotReady();
        if (quoteAmount == 0 || minimumBuybackOut == 0) revert ZeroValue();
        if (quoteAmount > pendingBuybackQuote) revert ReserveTooLow();
        pendingBuybackQuote -= quoteAmount;
        zktxBurned = _executeSwap(marketQuoteAsset, zktxToken, quoteAmount, minimumBuybackOut, address(this));
        _burnZktx(zktxBurned);
        totalZktxBurned += zktxBurned;
        emit PendingBuybackExecuted(quoteAmount, zktxBurned);
    }

    /// @notice Converts completed or expired order proceeds and any unspent input into private notes.
    function settleMarketOrder(
        bytes calldata proof,
        bytes32 orderId,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32 outputCommitment,
        bytes32 refundCommitment
    ) external nonReentrant whenActive {
        MarketOrder storage order = marketOrders[orderId];
        if (order.amountIn == 0) revert MarketOrderMissing();
        if (order.settled) revert MarketOrderClosed();
        uint256 readyAt = order.executedInput == order.amountIn
            ? uint256(order.lastExecutionAt) + MARKET_SETTLEMENT_DELAY
            : uint256(order.deadline) + MARKET_SETTLEMENT_DELAY;
        if (block.timestamp < readyAt) revert MarketNotReady();
        if (oldRoot != currentRoot || newRoot == bytes32(0)) revert InvalidRoot();
        if (
            outputCommitment == bytes32(0) || refundCommitment == bytes32(0)
                || outputCommitment == refundCommitment || knownCommitments[outputCommitment]
                || knownCommitments[refundCommitment]
        ) revert CommitmentAlreadyExists();

        uint256 refundAmount = order.amountIn - order.executedInput;
        _verifyMarketSettlement(
            proof, orderId, oldRoot, newRoot, outputCommitment, refundCommitment, order, refundAmount
        );

        order.settled = true;
        knownCommitments[outputCommitment] = true;
        knownCommitments[refundCommitment] = true;
        currentRoot = newRoot;
        knownRoots[newRoot] = true;
        noteCount += 2;
        pendingMarketProceeds[order.assetOut] -= order.netAmountOut;
        pendingMarketReserves[order.assetIn] -= refundAmount;
        publicReserves[order.assetOut] += order.netAmountOut;
        publicReserves[order.assetIn] += refundAmount;
        emit MarketOrderSettled(
            orderId, outputCommitment, refundCommitment, order.netAmountOut, refundAmount, newRoot
        );
    }

    function _verifyMarketSettlement(
        bytes calldata proof,
        bytes32 orderId,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32 outputCommitment,
        bytes32 refundCommitment,
        MarketOrder storage order,
        uint256 refundAmount
    ) private view {
        uint256[14] memory signals;
        signals[0] = _field(oldRoot);
        signals[1] = _field(newRoot);
        signals[2] = _field(outputCommitment);
        signals[3] = _field(refundCommitment);
        signals[4] = noteCount;
        signals[5] = noteCount + 1;
        signals[6] = _field(order.settlementKey);
        signals[7] = uint160(order.assetOut);
        signals[8] = order.netAmountOut;
        signals[9] = uint160(order.assetIn);
        signals[10] = refundAmount;
        signals[11] = block.chainid;
        signals[12] = uint160(address(this));
        signals[13] = _field(orderId);
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!marketSettlementVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();
    }

    function claimExecutionFees(address recipient, uint256 amount) external nonReentrant {
        if (msg.sender != executionFeeRecipient) revert OnlyFeeRecipient();
        if (recipient == address(0) || amount == 0) revert ZeroValue();
        if (executionFeeBalances[marketQuoteAsset] < amount) revert ReserveTooLow();
        executionFeeBalances[marketQuoteAsset] -= amount;
        _safeTransfer(marketQuoteAsset, recipient, amount);
        emit ExecutionFeesClaimed(marketQuoteAsset, recipient, amount);
    }

    function getMarketOrder(bytes32 orderId) external view returns (MarketOrder memory) {
        return marketOrders[orderId];
    }

    function marketOrderCount() external view returns (uint256) {
        return marketOrderIds.length;
    }

    function nextMarketSliceAmount(bytes32 orderId) public view returns (uint256) {
        MarketOrder storage order = marketOrders[orderId];
        if (order.amountIn == 0) revert MarketOrderMissing();
        uint256 remaining = order.amountIn - order.executedInput;
        uint256 remainingSlices = order.sliceCount - order.slicesExecuted;
        if (remainingSlices <= 1) return remaining;
        uint256 average = remaining / remainingSlices;
        uint256 lower = average / 2;
        if (lower == 0) lower = 1;
        uint256 upper = average + average / 2;
        uint256 maximum = remaining - (remainingSlices - 1);
        if (upper > maximum) upper = maximum;
        if (upper <= lower) return lower;
        uint256 random = uint256(
            keccak256(abi.encodePacked(blockhash(block.number - 1), orderId, order.slicesExecuted, remaining))
        );
        return lower + random % (upper - lower + 1);
    }

    function cancelOrder(
        bytes calldata proof,
        bytes32 oldRoot,
        bytes32 newRoot,
        bytes32 orderNullifier,
        bytes32 refundCommitment
    ) external whenActive {
        if (oldRoot != currentRoot || newRoot == bytes32(0)) revert InvalidRoot();
        if (spentNullifiers[orderNullifier]) revert NullifierAlreadySpent();
        if (knownCommitments[refundCommitment]) revert CommitmentAlreadyExists();
        uint256[7] memory signals;
        signals[0] = _field(oldRoot);
        signals[1] = _field(newRoot);
        signals[2] = _field(orderNullifier);
        signals[3] = _field(refundCommitment);
        signals[4] = noteCount;
        signals[5] = block.chainid;
        signals[6] = uint160(address(this));
        (uint256[2] memory a, uint256[2][2] memory b, uint256[2] memory c) = _decodeProof(proof);
        if (!cancelOrderVerifier.verifyProof(a, b, c, signals)) revert InvalidProof();
        spentNullifiers[orderNullifier] = true;
        knownCommitments[refundCommitment] = true;
        currentRoot = newRoot;
        knownRoots[newRoot] = true;
        noteCount += 1;
        emit PrivateOrderCancelled(oldRoot, newRoot, orderNullifier, refundCommitment);
    }

    function _executeBuySlice(MarketOrder storage order, uint256 sliceAmount, uint256 requiredSliceOut)
        private
        returns (SliceAccounting memory accounting)
    {
        uint256 targetExecutionFee = order.executedInput * EXECUTION_FEE_BPS / BPS;
        uint256 targetBuybackFee = order.executedInput * BUYBACK_FEE_BPS / BPS;
        accounting.executionFee = targetExecutionFee - order.executionFeeAmount;
        accounting.buybackFee = targetBuybackFee - order.buybackFeeAmount;
        uint256 tradingInput = sliceAmount - accounting.executionFee - accounting.buybackFee;
        accounting.grossAmountOut =
            _executeSwap(order.assetIn, order.assetOut, tradingInput, requiredSliceOut, address(this));
        accounting.userAmountOut = accounting.grossAmountOut;
    }

    function _executeSellSlice(MarketOrder storage order, uint256 sliceAmount, uint256 requiredSliceOut)
        private
        returns (SliceAccounting memory accounting)
    {
        uint256 minimumGrossOut = _ceilDiv(requiredSliceOut * BPS, BPS - TOTAL_MARKET_FEE_BPS);
        accounting.grossAmountOut =
            _executeSwap(order.assetIn, order.assetOut, sliceAmount, minimumGrossOut, address(this));
        uint256 nextGrossAmountOut = order.grossAmountOut + accounting.grossAmountOut;
        accounting.executionFee = nextGrossAmountOut * EXECUTION_FEE_BPS / BPS - order.executionFeeAmount;
        accounting.buybackFee = nextGrossAmountOut * BUYBACK_FEE_BPS / BPS - order.buybackFeeAmount;
        accounting.userAmountOut = accounting.grossAmountOut - accounting.executionFee - accounting.buybackFee;
        if (accounting.userAmountOut < requiredSliceOut) revert InvalidProof();
    }

    function _executeSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) private returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroValue();
        uint256 inputBefore = _balanceOf(tokenIn, address(this));
        uint256 outputBefore = _balanceOf(tokenOut, recipient);
        _forceApprove(tokenIn, address(marketAdapter), amountIn);
        uint256 reported =
            marketAdapter.swapExactInput(tokenIn, tokenOut, amountIn, minimumAmountOut, recipient);
        _forceApprove(tokenIn, address(marketAdapter), 0);
        uint256 inputAfter = _balanceOf(tokenIn, address(this));
        uint256 outputAfter = _balanceOf(tokenOut, recipient);
        if (inputBefore - inputAfter != amountIn || outputAfter < outputBefore) revert TransferFailed();
        amountOut = outputAfter - outputBefore;
        if (amountOut != reported || amountOut < minimumAmountOut || amountOut > type(uint128).max) {
            revert TransferFailed();
        }
    }

    function _balanceOf(address token, address account) private view returns (uint256 balance) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!ok || data.length < 32) revert TransferFailed();
        balance = abi.decode(data, (uint256));
    }

    function _privateExposure(address asset) private view returns (uint256) {
        return publicReserves[asset] + pendingMarketReserves[asset] + pendingMarketProceeds[asset];
    }

    function _totalSupply(address token) private view returns (uint256 supply) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x18160ddd));
        if (!ok || data.length < 32) revert TransferFailed();
        supply = abi.decode(data, (uint256));
    }

    /// @dev PONS V2 launcher tokens inherit ERC20Burnable. Delta checks prevent a no-op fallback
    ///      or a non-standard token from being accounted as a real supply burn.
    function _burnZktx(uint256 amount) private {
        uint256 balanceBefore = _balanceOf(zktxToken, address(this));
        uint256 supplyBefore = _totalSupply(zktxToken);
        (bool ok, bytes memory data) = zktxToken.call(abi.encodeWithSelector(0x42966c68, amount));
        if (!ok || data.length != 0) revert TransferFailed();
        uint256 balanceAfter = _balanceOf(zktxToken, address(this));
        uint256 supplyAfter = _totalSupply(zktxToken);
        if (balanceBefore - balanceAfter != amount || supplyBefore - supplyAfter != amount) {
            revert TransferFailed();
        }
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        (bool resetOk, bytes memory resetData) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, 0));
        if (!resetOk || (resetData.length != 0 && !abi.decode(resetData, (bool)))) {
            revert TransferFailed();
        }
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _ceilDiv(uint256 numerator, uint256 denominator) private pure returns (uint256) {
        if (numerator == 0) return 0;
        return (numerator - 1) / denominator + 1;
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
