// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./ISwapAdapter.sol";

interface IERC20ForPonsV2Adapter {
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IWrappedNativeForPonsV2Adapter is IERC20ForPonsV2Adapter {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface IPonsV2CurveForAdapter {
    function readyToGraduate() external view returns (bool);

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        returns (uint256 tokensOut);

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
        external
        returns (uint256 quoteOut);
}

interface IPonsV2FactoryForAdapter {
    enum GraduationPhase {
        NotGraduated,
        Swept,
        PoolCreated,
        Rescued
    }

    struct LaunchedToken {
        address token;
        address curve;
        address deployer;
        address creatorFeeRecipient;
        address pairToken;
        uint256 graduationThreshold;
        uint24 poolFee;
        int24 tickSpacing;
        uint16 creatorTaxBps;
        bool buybackEnabled;
        GraduationPhase phase;
        uint256 sweptQuote;
        uint256 sweptTokens;
        uint256 sweptAt;
        bool exists;
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory);
    function poolManager() external view returns (address);
    function memeHook() external view returns (address);
    function graduate(address token) external;
    function createGraduatedPool(address token) external returns (uint256 positionId);
}

interface IPonsV4PoolManagerForAdapter {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory result);
    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (int256 delta);
    function sync(address currency) external;
    function settle() external payable returns (uint256 paid);
    function take(address currency, address to, uint256 amount) external;
}

/// @notice Routes a PONS V2 launch through its bonding curve before graduation and
///         its canonical Uniswap V4 pool afterward.
/// @dev Native-ETH launches are normalized to wrapped native token at the vault boundary.
contract PonsV2SwapAdapter is ISwapAdapter {
    uint160 private constant MIN_SQRT_PRICE_PLUS_ONE = 4_295_128_740;
    uint160 private constant MAX_SQRT_PRICE_MINUS_ONE =
        1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_341;

    error InexactInput();
    error InvalidConfiguration();
    error InvalidLaunch();
    error ReentrantCall();
    error SlippageExceeded();
    error TransferFailed();
    error UnsupportedPhase();

    IPonsV2FactoryForAdapter public immutable factory;
    IPonsV4PoolManagerForAdapter public immutable poolManager;
    address public immutable memeHook;
    address public immutable quoteAsset;
    IWrappedNativeForPonsV2Adapter public immutable wrappedNative;

    uint256 private unlocked = 1;

    constructor(IPonsV2FactoryForAdapter factory_, address quoteAsset_, IWrappedNativeForPonsV2Adapter wrappedNative_) {
        if (address(factory_) == address(0) || quoteAsset_ == address(0) || address(wrappedNative_) == address(0)) {
            revert InvalidConfiguration();
        }
        address manager = factory_.poolManager();
        address hook = factory_.memeHook();
        if (manager == address(0) || hook == address(0)) revert InvalidConfiguration();
        factory = factory_;
        poolManager = IPonsV4PoolManagerForAdapter(manager);
        memeHook = hook;
        quoteAsset = quoteAsset_;
        wrappedNative = wrappedNative_;
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (unlocked != 1) revert ReentrantCall();
        if (
            tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut || amountIn == 0
                || amountIn > uint256(uint128(type(int128).max))
                || recipient == address(0)
        ) revert InvalidConfiguration();
        unlocked = 2;

        (IPonsV2FactoryForAdapter.LaunchedToken memory launch, address memecoin) =
            _validatedLaunch(tokenIn, tokenOut);
        if (
            launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated
                && IPonsV2CurveForAdapter(launch.curve).readyToGraduate()
        ) {
            factory.graduate(memecoin);
            launch = factory.getLaunchedToken(memecoin);
        }
        if (launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.Swept) {
            factory.createGraduatedPool(memecoin);
            launch = factory.getLaunchedToken(memecoin);
        }
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        if (launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated) {
            amountOut = _swapCurve(launch, memecoin, tokenIn, amountIn, minimumAmountOut, recipient);
        } else if (launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated) {
            amountOut = _swapV4(launch, memecoin, tokenIn, amountIn, minimumAmountOut, recipient);
        } else {
            revert UnsupportedPhase();
        }
        if (amountOut < minimumAmountOut) revert SlippageExceeded();
        unlocked = 1;
    }

    /// @notice Uniswap V4 callback. It can only run inside this adapter's active unlock.
    function unlockCallback(bytes calldata data) external returns (bytes memory result) {
        if (msg.sender != address(poolManager) || unlocked != 2) revert ReentrantCall();
        (
            IPonsV2FactoryForAdapter.LaunchedToken memory launch,
            address memecoin,
            address tokenIn,
            uint256 amountIn
        ) = abi.decode(data, (IPonsV2FactoryForAdapter.LaunchedToken, address, address, uint256));
        if (launch.phase != IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated) revert UnsupportedPhase();

        address nativePair = launch.pairToken;
        (address currency0, address currency1) = memecoin < nativePair
            ? (memecoin, nativePair)
            : (nativePair, memecoin);
        bool zeroForOne = _v4Currency(tokenIn, launch.pairToken) == currency0;
        int256 delta = poolManager.swap(
            IPonsV4PoolManagerForAdapter.PoolKey({
                currency0: currency0,
                currency1: currency1,
                fee: launch.poolFee,
                tickSpacing: launch.tickSpacing,
                hooks: memeHook
            }),
            IPonsV4PoolManagerForAdapter.SwapParams({
                zeroForOne: zeroForOne,
                // amountIn is bounded to int128.max at the public entry point.
                // forge-lint: disable-next-line(unsafe-typecast)
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: zeroForOne ? MIN_SQRT_PRICE_PLUS_ONE : MAX_SQRT_PRICE_MINUS_ONE
            }),
            ""
        );

        // BalanceDelta's canonical representation packs signed int128 amount0/amount1.
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 amount0 = int128(uint128(uint256(delta >> 128)));
        // forge-lint: disable-next-line(unsafe-typecast)
        int128 amount1 = int128(uint128(uint256(delta)));
        _settle(currency0, amount0);
        _settle(currency1, amount1);
        int128 inputDelta = zeroForOne ? amount0 : amount1;
        int128 outputDelta = zeroForOne ? amount1 : amount0;
        // Sign checks make both signed-to-unsigned conversions lossless.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 consumed = inputDelta < 0 ? uint256(-int256(inputDelta)) : 0;
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 amountOut = outputDelta > 0 ? uint256(int256(outputDelta)) : 0;
        result = abi.encode(consumed, amountOut);
    }

    function _validatedLaunch(address tokenIn, address tokenOut)
        private
        view
        returns (IPonsV2FactoryForAdapter.LaunchedToken memory launch, address memecoin)
    {
        memecoin = tokenIn == quoteAsset ? tokenOut : tokenIn;
        if (tokenIn != quoteAsset && tokenOut != quoteAsset) revert InvalidLaunch();
        launch = factory.getLaunchedToken(memecoin);
        if (!launch.exists || launch.token != memecoin || launch.curve == address(0)) revert InvalidLaunch();
        address normalizedPair = launch.pairToken == address(0) ? address(wrappedNative) : launch.pairToken;
        if (normalizedPair != quoteAsset) revert InvalidLaunch();
    }

    function _swapCurve(
        IPonsV2FactoryForAdapter.LaunchedToken memory launch,
        address memecoin,
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) private returns (uint256 amountOut) {
        IPonsV2CurveForAdapter curve = IPonsV2CurveForAdapter(launch.curve);
        if (tokenIn == quoteAsset) {
            if (launch.pairToken == address(0)) {
                uint256 nativeBefore = address(this).balance;
                wrappedNative.withdraw(amountIn);
                amountOut = curve.buy{value: amountIn}(amountIn, 0, recipient);
                uint256 refund = address(this).balance - nativeBefore;
                if (refund != 0) {
                    wrappedNative.deposit{value: refund}();
                    amountOut += _routeGraduationRefund(launch, memecoin, refund, recipient);
                }
            } else {
                uint256 quoteBefore = _balanceOf(quoteAsset, address(this)) - amountIn;
                _forceApprove(quoteAsset, launch.curve, amountIn);
                amountOut = curve.buy(amountIn, 0, recipient);
                _forceApprove(quoteAsset, launch.curve, 0);
                uint256 refund = _balanceOf(quoteAsset, address(this)) - quoteBefore;
                if (refund != 0) amountOut += _routeGraduationRefund(launch, memecoin, refund, recipient);
            }
        } else {
            _forceApprove(memecoin, launch.curve, amountIn);
            amountOut = curve.sell(amountIn, minimumAmountOut, address(this));
            _forceApprove(memecoin, launch.curve, 0);
            if (launch.pairToken == address(0)) wrappedNative.deposit{value: amountOut}();
            _safeTransfer(quoteAsset, recipient, amountOut);
        }
        if (amountOut < minimumAmountOut) revert SlippageExceeded();
    }

    function _routeGraduationRefund(
        IPonsV2FactoryForAdapter.LaunchedToken memory previous,
        address memecoin,
        uint256 refund,
        address recipient
    ) private returns (uint256 amountOut) {
        IPonsV2FactoryForAdapter.LaunchedToken memory launch = factory.getLaunchedToken(memecoin);
        if (launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated) {
            factory.graduate(memecoin);
            launch = factory.getLaunchedToken(memecoin);
        }
        if (launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.Swept) {
            factory.createGraduatedPool(memecoin);
            launch = factory.getLaunchedToken(memecoin);
        }
        if (
            launch.phase != IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated
                || launch.curve != previous.curve || launch.pairToken != previous.pairToken
                || launch.poolFee != previous.poolFee || launch.tickSpacing != previous.tickSpacing
        ) revert UnsupportedPhase();
        amountOut = _swapV4(launch, memecoin, quoteAsset, refund, 0, recipient);
    }

    function _swapV4(
        IPonsV2FactoryForAdapter.LaunchedToken memory launch,
        address memecoin,
        address tokenIn,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) private returns (uint256 amountOut) {
        if (launch.pairToken == address(0) && tokenIn == quoteAsset) wrappedNative.withdraw(amountIn);
        bytes memory returned = poolManager.unlock(abi.encode(launch, memecoin, tokenIn, amountIn));
        (uint256 consumed, uint256 received) = abi.decode(returned, (uint256, uint256));
        if (consumed != amountIn) revert InexactInput();
        amountOut = received;
        if (launch.pairToken == address(0) && tokenIn != quoteAsset) wrappedNative.deposit{value: amountOut}();
        _safeTransfer(tokenIn == quoteAsset ? memecoin : quoteAsset, recipient, amountOut);
        if (amountOut < minimumAmountOut) revert SlippageExceeded();
    }

    function _settle(address currency, int128 delta) private {
        if (delta < 0) {
            // The negative branch makes the conversion lossless.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint256 owed = uint256(-int256(delta));
            poolManager.sync(currency);
            if (currency == address(0)) {
                poolManager.settle{value: owed}();
            } else {
                _safeTransfer(currency, address(poolManager), owed);
                poolManager.settle();
            }
        } else if (delta > 0) {
            // The positive branch makes the conversion lossless.
            // forge-lint: disable-next-line(unsafe-typecast)
            poolManager.take(currency, address(this), uint256(int256(delta)));
        }
    }

    function _v4Currency(address token, address pairToken) private view returns (address) {
        return pairToken == address(0) && token == quoteAsset ? address(0) : token;
    }

    function _balanceOf(address token, address account) private view returns (uint256 balance) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!ok || data.length < 32) revert TransferFailed();
        balance = abi.decode(data, (uint256));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20ForPonsV2Adapter.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20ForPonsV2Adapter.transfer.selector, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        (bool resetOk, bytes memory resetData) =
            token.call(abi.encodeWithSelector(IERC20ForPonsV2Adapter.approve.selector, spender, 0));
        if (!resetOk || (resetData.length != 0 && !abi.decode(resetData, (bool)))) revert TransferFailed();
        if (amount == 0) return;
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20ForPonsV2Adapter.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    receive() external payable {
        // Wrapped-native withdrawals, V4 takes, and native curve payouts only occur
        // while swapExactInput holds the adapter's reentrancy lock.
        if (unlocked != 2) revert TransferFailed();
    }
}
