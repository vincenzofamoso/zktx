// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "./ISwapAdapter.sol";

/// @notice Direction-specific router for approved Robinhood Chain execution adapters.
/// @dev A vault can trust this adapter once and add reviewed venue adapters after a delay.
///      Routes are exact tokenIn/tokenOut pairs; reverse routes must be approved separately.
contract RhRoutingSwapAdapter is ISwapAdapter {
    error InvalidConfiguration();
    error NoRoute();
    error RouteNotReady();
    error TransferFailed();
    error Unauthorized();
    error ReentrantCall();

    struct PendingRoute {
        address adapter;
        uint64 activateAfter;
    }

    event RouteProposed(
        address indexed tokenIn, address indexed tokenOut, address indexed adapter, uint64 activateAfter
    );
    event RouteActivated(address indexed tokenIn, address indexed tokenOut, address indexed adapter);
    event RouteDisabled(address indexed tokenIn, address indexed tokenOut, address indexed previousAdapter);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed nextOwner);

    uint64 public immutable routeDelay;
    address public owner;
    address public pendingOwner;
    mapping(bytes32 => address) public routes;
    mapping(bytes32 => PendingRoute) public pendingRoutes;
    uint256 private unlocked = 1;

    constructor(address owner_, uint64 routeDelay_) {
        if (owner_ == address(0)) revert InvalidConfiguration();
        owner = owner_;
        routeDelay = routeDelay_;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function routeKey(address tokenIn, address tokenOut) public pure returns (bytes32) {
        return keccak256(abi.encode(tokenIn, tokenOut));
    }

    function proposeRoute(address tokenIn, address tokenOut, address adapter) external onlyOwner {
        if (
            tokenIn == address(0) || tokenOut == address(0) || tokenIn == tokenOut || adapter == address(0)
                || adapter == address(this) || adapter.code.length == 0
        ) revert InvalidConfiguration();
        uint64 activateAfter = uint64(block.timestamp) + routeDelay;
        pendingRoutes[routeKey(tokenIn, tokenOut)] = PendingRoute(adapter, activateAfter);
        emit RouteProposed(tokenIn, tokenOut, adapter, activateAfter);
    }

    /// @notice Permissionless activation prevents an unavailable owner from blocking an elapsed proposal.
    function activateRoute(address tokenIn, address tokenOut) external {
        bytes32 key = routeKey(tokenIn, tokenOut);
        PendingRoute memory pending = pendingRoutes[key];
        if (pending.adapter == address(0)) revert NoRoute();
        if (block.timestamp < pending.activateAfter) revert RouteNotReady();
        routes[key] = pending.adapter;
        delete pendingRoutes[key];
        emit RouteActivated(tokenIn, tokenOut, pending.adapter);
    }

    /// @notice Incident response is immediate; enabling or replacing a route remains delayed.
    function disableRoute(address tokenIn, address tokenOut) external onlyOwner {
        bytes32 key = routeKey(tokenIn, tokenOut);
        address previous = routes[key];
        delete routes[key];
        delete pendingRoutes[key];
        emit RouteDisabled(tokenIn, tokenOut, previous);
    }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert InvalidConfiguration();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
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
                || recipient == address(0)
        ) revert InvalidConfiguration();
        address adapter = routes[routeKey(tokenIn, tokenOut)];
        if (adapter == address(0)) revert NoRoute();
        unlocked = 2;

        uint256 inputBefore = _balanceOf(tokenIn, address(this));
        uint256 outputBefore = _balanceOf(tokenOut, recipient);
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        if (_balanceOf(tokenIn, address(this)) - inputBefore != amountIn) revert TransferFailed();
        _forceApprove(tokenIn, adapter, amountIn);
        uint256 reported =
            ISwapAdapter(adapter).swapExactInput(tokenIn, tokenOut, amountIn, minimumAmountOut, recipient);
        _forceApprove(tokenIn, adapter, 0);

        uint256 inputAfter = _balanceOf(tokenIn, address(this));
        uint256 outputAfter = _balanceOf(tokenOut, recipient);
        if (inputAfter != inputBefore || outputAfter < outputBefore) revert TransferFailed();
        amountOut = outputAfter - outputBefore;
        if (amountOut != reported || amountOut < minimumAmountOut) revert TransferFailed();
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

    function _forceApprove(address token, address spender, uint256 amount) private {
        (bool resetOk, bytes memory resetData) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, 0));
        if (!resetOk || (resetData.length != 0 && !abi.decode(resetData, (bool)))) revert TransferFailed();
        if (amount == 0) return;
        (bool ok, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
