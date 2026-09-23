// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./ISwapAdapter.sol";

/// @notice Executes one keeper-prepared exact-input quote through a pinned aggregation entry point.
/// @dev The vault's routing adapter is the only caller. Output is measured rather than trusted.
contract AggregatorSwapAdapter is ISwapAdapter {
    error InvalidConfiguration();
    error NoPreparedSwap();
    error ReentrantCall();
    error TransferFailed();
    error Unauthorized();

    struct PreparedSwap {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minimumAmountOut;
        uint64 deadline;
        bytes callData;
    }

    address public immutable trustedRouter;
    address public immutable entryPoint;
    address public operator;
    PreparedSwap private prepared;
    uint256 private unlocked = 1;

    event SwapPrepared(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint64 deadline);
    event OperatorChanged(address indexed previousOperator, address indexed nextOperator);

    constructor(address trustedRouter_, address entryPoint_, address operator_) {
        if (
            trustedRouter_ == address(0) || entryPoint_ == address(0) || operator_ == address(0)
                || trustedRouter_.code.length == 0 || entryPoint_.code.length == 0
        ) revert InvalidConfiguration();
        trustedRouter = trustedRouter_;
        entryPoint = entryPoint_;
        operator = operator_;
    }

    function setOperator(address nextOperator) external {
        if (msg.sender != operator) revert Unauthorized();
        if (nextOperator == address(0)) revert InvalidConfiguration();
        emit OperatorChanged(operator, nextOperator);
        operator = nextOperator;
    }

    function prepareSwap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        uint64 deadline,
        bytes calldata callData
    ) external {
        if (msg.sender != operator) revert Unauthorized();
        if (
            tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut || amountIn == 0
                || minimumAmountOut == 0 || deadline <= block.timestamp || callData.length < 4
        ) revert InvalidConfiguration();
        prepared = PreparedSwap(tokenIn, tokenOut, amountIn, minimumAmountOut, deadline, callData);
        emit SwapPrepared(tokenIn, tokenOut, amountIn, deadline);
    }

    function preparedSwap() external view returns (address, address, uint256, uint256, uint64, bytes memory) {
        PreparedSwap storage item = prepared;
        return (item.tokenIn, item.tokenOut, item.amountIn, item.minimumAmountOut, item.deadline, item.callData);
    }

    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        if (msg.sender != trustedRouter) revert Unauthorized();
        if (unlocked != 1) revert ReentrantCall();
        PreparedSwap memory item = prepared;
        if (
            item.tokenIn != tokenIn || item.tokenOut != tokenOut || item.amountIn != amountIn
                || item.minimumAmountOut < minimumAmountOut || item.deadline < block.timestamp
        ) revert NoPreparedSwap();
        delete prepared;
        unlocked = 2;

        uint256 inputBefore = _balanceOf(tokenIn, address(this));
        uint256 outputBefore = _balanceOf(tokenOut, address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        if (_balanceOf(tokenIn, address(this)) - inputBefore != amountIn) revert TransferFailed();
        _forceApprove(tokenIn, entryPoint, amountIn);
        (bool ok,) = entryPoint.call(item.callData);
        _forceApprove(tokenIn, entryPoint, 0);
        if (!ok) revert TransferFailed();

        uint256 inputAfter = _balanceOf(tokenIn, address(this));
        uint256 outputAfter = _balanceOf(tokenOut, address(this));
        if (inputAfter != inputBefore || outputAfter <= outputBefore) revert TransferFailed();
        amountOut = outputAfter - outputBefore;
        if (amountOut < minimumAmountOut) revert TransferFailed();
        _safeTransfer(tokenOut, recipient, amountOut);
        unlocked = 1;
    }

    function _balanceOf(address token, address account) private view returns (uint256 balance) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(0x70a08231, account));
        if (!ok || data.length < 32) revert TransferFailed();
        balance = abi.decode(data, (uint256));
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransfer(address token, address to, uint256 amount) private {
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _forceApprove(address token, address spender, uint256 amount) private {
        (bool resetOk, bytes memory resetData) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, 0));
        if (!resetOk || (resetData.length != 0 && !abi.decode(resetData, (bool)))) revert TransferFailed();
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
