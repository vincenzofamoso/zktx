// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./ISwapAdapter.sol";

interface IERC20ForAdapter {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUniswapV3SwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

/// @notice Single-hop adapter for PONS V1 launches, which use WETH-quoted Uniswap V3 pools.
/// @dev PONS V2 uses the separate lifecycle-aware PonsV2SwapAdapter.
contract PonsV3SwapAdapter is ISwapAdapter {
    error InvalidConfiguration();
    error ReentrantCall();
    error TransferFailed();
    error UnsupportedPair();

    IUniswapV3SwapRouter public immutable router;
    address public immutable quoteAsset;
    uint24 public immutable poolFee;
    uint256 private unlocked = 1;

    constructor(IUniswapV3SwapRouter router_, address quoteAsset_, uint24 poolFee_) {
        if (address(router_) == address(0) || quoteAsset_ == address(0) || poolFee_ == 0) {
            revert InvalidConfiguration();
        }
        router = router_;
        quoteAsset = quoteAsset_;
        poolFee = poolFee_;
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (unlocked != 1) revert ReentrantCall();
        unlocked = 2;
        if (
            tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut || recipient == address(0)
                || amountIn == 0
        ) revert InvalidConfiguration();
        if (tokenIn != quoteAsset && tokenOut != quoteAsset) revert UnsupportedPair();

        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        _forceApprove(tokenIn, address(router), amountIn);
        amountOut = router.exactInputSingle(
            IUniswapV3SwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: recipient,
                amountIn: amountIn,
                amountOutMinimum: minimumAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
        _forceApprove(tokenIn, address(router), 0);
        unlocked = 1;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20ForAdapter.transferFrom.selector, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        (bool resetOk, bytes memory resetData) =
            token.call(abi.encodeWithSelector(IERC20ForAdapter.approve.selector, spender, 0));
        if (!resetOk || (resetData.length != 0 && !abi.decode(resetData, (bool)))) revert TransferFailed();
        if (amount == 0) return;
        (bool ok, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20ForAdapter.approve.selector, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
