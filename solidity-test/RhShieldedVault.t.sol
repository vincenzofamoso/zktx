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
} from "../contracts/IZkVerifier.sol";
import {ISwapAdapter} from "../contracts/ISwapAdapter.sol";
import {RhShieldedVault} from "../contracts/RhShieldedVault.sol";

interface Vm {
    function roll(uint256 nextBlock) external;
    function warp(uint256 nextTimestamp) external;
}

contract MockVerifier is
    IDepositVerifier,
    ITransferVerifier,
    IWithdrawVerifier,
    ISwapVerifier,
    ICancelOrderVerifier,
    IMarketOrderVerifier,
    IMarketSettlementVerifier
{
    bool public result = true;

    function setResult(bool next) external {
        result = next;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[8] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[13] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[9] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[7] calldata
    ) external view override(IWithdrawVerifier, ICancelOrderVerifier) returns (bool) {
        return result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[10] calldata
    ) external view returns (bool) {
        return result;
    }

    function verifyProof(
        uint256[2] calldata,
        uint256[2][2] calldata,
        uint256[2] calldata,
        uint256[14] calldata
    ) external view returns (bool) {
        return result;
    }
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
        totalSupply += value;
    }

    function burn(uint256 value) external virtual {
        balanceOf[msg.sender] -= value;
        totalSupply -= value;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        balanceOf[msg.sender] -= value;
        balanceOf[to] += value;
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        allowance[from][msg.sender] -= value;
        balanceOf[from] -= value;
        balanceOf[to] += value;
        return true;
    }
}

contract MockNoopBurnToken is MockToken {
    function burn(uint256) external override {}
}

contract MockMarketAdapter is ISwapAdapter {
    function swapExactInput(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        require(MockToken(tokenIn).transferFrom(msg.sender, address(this), amountIn), "input transfer");
        amountOut = amountIn;
        require(amountOut >= minimumAmountOut, "minimum output");
        MockToken(tokenOut).mint(recipient, amountOut);
    }
}

contract RhShieldedVaultTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockVerifier verifier;
    MockToken token;
    MockToken quote;
    MockToken zktx;
    MockMarketAdapter adapter;
    RhShieldedVault vault;
    bytes32 constant ROOT = bytes32(uint256(11));

    function proof() internal pure returns (bytes memory) {
        return abi.encode(
            uint256[2]([uint256(1), 2]), [[uint256(3), 4], [uint256(5), 6]], uint256[2]([uint256(7), 8])
        );
    }

    function setUp() public {
        verifier = new MockVerifier();
        token = new MockToken();
        quote = new MockToken();
        zktx = new MockToken();
        adapter = new MockMarketAdapter();
        vault = new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        vault.setAssetSupported(address(token), true);
        vault.setAssetSupported(address(quote), true);
        vault.setReserveCap(address(token), 200 ether);
        vault.setReserveCap(address(quote), 200 ether);
        vault.configureMarket(verifier, verifier, adapter, address(quote), address(zktx), address(this));
        token.mint(address(this), 1_000 ether);
        quote.mint(address(this), 1_000 ether);
        token.approve(address(vault), type(uint256).max);
        quote.approve(address(vault), type(uint256).max);
    }

    function testDepositTransferWithdrawLifecycle() public {
        bytes32 commitment = bytes32(uint256(101));
        vault.deposit(proof(), address(token), 100 ether, commitment, bytes32(uint256(12)));
        require(vault.publicReserves(address(token)) == 100 ether, "reserve");
        require(vault.noteCount() == 1, "note count after deposit");

        bytes32 nullifier = bytes32(uint256(201));
        vault.transact(
            proof(),
            bytes32(uint256(12)),
            bytes32(uint256(13)),
            nullifier,
            bytes32(uint256(102)),
            bytes32(uint256(103))
        );
        require(vault.spentNullifiers(nullifier), "nullifier");
        require(vault.noteCount() == 3, "note count after transfer");

        bytes32 withdrawNullifier = bytes32(uint256(202));
        vault.withdraw(
            proof(), bytes32(uint256(13)), address(token), address(this), 40 ether, withdrawNullifier
        );
        require(vault.publicReserves(address(token)) == 60 ether, "remaining reserve");
        require(token.balanceOf(address(this)) == 940 ether, "wallet balance");
    }

    function testRejectsInvalidProof() public {
        verifier.setResult(false);
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.deposit,
                    (proof(), address(token), 1 ether, bytes32(uint256(1)), bytes32(uint256(12)))
                )
            );
        require(!ok, "invalid proof accepted");
    }

    function testRejectsSpentNullifier() public {
        vault.deposit(proof(), address(token), 10 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        bytes32 nullifier = bytes32(uint256(201));
        vault.transact(
            proof(),
            bytes32(uint256(12)),
            bytes32(uint256(13)),
            nullifier,
            bytes32(uint256(102)),
            bytes32(uint256(103))
        );
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.transact,
                    (
                        proof(),
                        bytes32(uint256(13)),
                        bytes32(uint256(14)),
                        nullifier,
                        bytes32(uint256(104)),
                        bytes32(uint256(105))
                    )
                )
            );
        require(!ok, "spent nullifier accepted");
    }

    function testPauseBlocksDeposits() public {
        vault.setPaused(true);
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.deposit,
                    (proof(), address(token), 1 ether, bytes32(uint256(1)), bytes32(uint256(12)))
                )
            );
        require(!ok, "paused deposit accepted");
    }

    function testReserveCapBlocksExcessDeposit() public {
        (bool ok,) = address(vault)
            .call(
                abi.encodeCall(
                    vault.deposit,
                    (proof(), address(token), 201 ether, bytes32(uint256(1)), bytes32(uint256(12)))
                )
            );
        require(!ok, "reserve cap exceeded");
    }

    function testPrivateSwapLifecycle() public {
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(102)), bytes32(uint256(13)));
        vault.settleSwap(
            proof(),
            bytes32(uint256(13)),
            bytes32(uint256(14)),
            bytes32(uint256(201)),
            bytes32(uint256(202)),
            bytes32(uint256(301)),
            bytes32(uint256(302)),
            bytes32(uint256(303)),
            block.timestamp + 1 hours
        );
        require(vault.noteCount() == 5, "swap output count");
        require(vault.spentNullifiers(bytes32(uint256(201))), "maker nullifier");
        require(vault.spentNullifiers(bytes32(uint256(202))), "taker nullifier");
    }

    function testPrivateOrderCancellation() public {
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        vault.cancelOrder(
            proof(), bytes32(uint256(12)), bytes32(uint256(13)), bytes32(uint256(201)), bytes32(uint256(301))
        );
        require(vault.noteCount() == 2, "cancel output count");
        require(vault.spentNullifiers(bytes32(uint256(201))), "order nullifier");
    }

    function testSlicedSellChargesFeesAndImmediatelyBurnsBuyback() public {
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(501));
        vault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(601)),
            block.timestamp + 5 minutes
        );

        RhShieldedVault.MarketOrder memory order = vault.getMarketOrder(orderId);
        while (order.executedInput < order.amountIn) {
            vault.executeNextMarketSlice(orderId, 1);
            vm.roll(block.number + 1);
            order = vault.getMarketOrder(orderId);
        }

        require(order.netAmountOut == 98.5 ether, "net sell proceeds");
        require(vault.executionFeeBalances(address(quote)) == 0.5 ether, "execution reserve");
        require(vault.totalBuybackQuote() == 1 ether, "buyback quote");
        require(vault.totalZktxBurned() == 1 ether, "burn accounting");
        require(zktx.totalSupply() == 0, "supply burn");

        vm.warp(block.timestamp + 30 seconds);
        vault.settleMarketOrder(
            proof(),
            orderId,
            bytes32(uint256(12)),
            bytes32(uint256(13)),
            bytes32(uint256(701)),
            bytes32(uint256(702))
        );
        require(vault.publicReserves(address(quote)) == 98.5 ether, "private quote backing");
        require(vault.publicReserves(address(token)) == 0, "sold token backing");
        require(vault.noteCount() == 3, "deposit plus settlement notes");
    }

    function testSlicedBuyTakesFeesFromQuoteInput() public {
        vault.deposit(proof(), address(quote), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(502));
        vault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(quote),
            100 ether,
            address(token),
            90 ether,
            orderId,
            bytes32(uint256(602)),
            block.timestamp + 5 minutes
        );

        RhShieldedVault.MarketOrder memory order = vault.getMarketOrder(orderId);
        while (order.executedInput < order.amountIn) {
            vault.executeNextMarketSlice(orderId, 1);
            vm.roll(block.number + 1);
            order = vault.getMarketOrder(orderId);
        }

        require(order.netAmountOut == 98.5 ether, "net bought tokens");
        require(vault.executionFeeBalances(address(quote)) == 0.5 ether, "execution reserve");
        require(vault.totalZktxBurned() == 1 ether, "immediate buyback and burn");
        require(zktx.totalSupply() == 0, "supply burn");
    }

    function testPreTokenModeAccruesThenBurnsPendingBuyback() public {
        RhShieldedVault pilot =
            new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        pilot.setAssetSupported(address(token), true);
        pilot.setAssetSupported(address(quote), true);
        pilot.setReserveCap(address(token), 200 ether);
        pilot.setReserveCap(address(quote), 200 ether);
        pilot.configureMarket(verifier, verifier, adapter, address(quote), address(0), address(this));
        token.approve(address(pilot), type(uint256).max);
        pilot.deposit(proof(), address(token), 100 ether, bytes32(uint256(121)), bytes32(uint256(12)));

        bytes32 orderId = bytes32(uint256(521));
        pilot.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(621)),
            block.timestamp + 5 minutes
        );
        RhShieldedVault.MarketOrder memory order = pilot.getMarketOrder(orderId);
        while (order.executedInput < order.amountIn) {
            pilot.executeNextMarketSlice(orderId, 0);
            vm.roll(block.number + 1);
            order = pilot.getMarketOrder(orderId);
        }

        require(pilot.pendingBuybackQuote() == 1 ether, "pending buyback quote");
        require(pilot.totalZktxBurned() == 0, "unexpected pre-token burn");
        pilot.activateBuybackToken(address(zktx));
        pilot.executePendingBuyback(1 ether, 1);
        require(pilot.pendingBuybackQuote() == 0, "pending buyback not cleared");
        require(pilot.totalZktxBurned() == 1 ether, "pending buyback not burned");
        require(zktx.totalSupply() == 0, "pending supply burn");
    }

    function testPreTokenModeRejectsNonzeroBuybackMinimum() public {
        RhShieldedVault pilot =
            new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        pilot.setAssetSupported(address(token), true);
        pilot.setAssetSupported(address(quote), true);
        pilot.setReserveCap(address(token), 200 ether);
        pilot.setReserveCap(address(quote), 200 ether);
        pilot.configureMarket(verifier, verifier, adapter, address(quote), address(0), address(this));
        token.approve(address(pilot), type(uint256).max);
        pilot.deposit(proof(), address(token), 100 ether, bytes32(uint256(122)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(522));
        pilot.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(622)),
            block.timestamp + 5 minutes
        );
        (bool ok,) = address(pilot).call(abi.encodeCall(pilot.executeNextMarketSlice, (orderId, 1)));
        require(!ok, "pre-token mode accepted buyback minimum");
    }

    function testMarketSliceCannotExecuteTwiceInOneBlock() public {
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(503));
        vault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(603)),
            block.timestamp + 5 minutes
        );
        vault.executeNextMarketSlice(orderId, 1);
        (bool ok,) = address(vault).call(abi.encodeCall(vault.executeNextMarketSlice, (orderId, 1)));
        require(!ok, "same-block slice accepted");
    }

    function testBuybackRejectsTokenThatDoesNotActuallyBurnSupply() public {
        MockNoopBurnToken badZktx = new MockNoopBurnToken();
        RhShieldedVault badVault =
            new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        badVault.setAssetSupported(address(token), true);
        badVault.setAssetSupported(address(quote), true);
        badVault.setReserveCap(address(token), 200 ether);
        badVault.setReserveCap(address(quote), 200 ether);
        badVault.configureMarket(verifier, verifier, adapter, address(quote), address(badZktx), address(this));
        token.approve(address(badVault), type(uint256).max);
        badVault.deposit(proof(), address(token), 100 ether, bytes32(uint256(111)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(505));
        badVault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(605)),
            block.timestamp + 5 minutes
        );
        (bool ok,) = address(badVault).call(abi.encodeCall(badVault.executeNextMarketSlice, (orderId, 1)));
        require(!ok, "no-op burn accepted");
        RhShieldedVault.MarketOrder memory order = badVault.getMarketOrder(orderId);
        require(order.executedInput == 0, "failed slice retained state");
    }

    function testMarketOutputCannotBypassReserveCap() public {
        RhShieldedVault cappedVault =
            new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        cappedVault.setAssetSupported(address(token), true);
        cappedVault.setAssetSupported(address(quote), true);
        cappedVault.setReserveCap(address(token), 200 ether);
        cappedVault.setReserveCap(address(quote), 1 ether);
        cappedVault.configureMarket(verifier, verifier, adapter, address(quote), address(zktx), address(this));
        token.approve(address(cappedVault), type(uint256).max);
        cappedVault.deposit(proof(), address(token), 100 ether, bytes32(uint256(112)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(506));
        cappedVault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(606)),
            block.timestamp + 5 minutes
        );
        (bool ok,) =
            address(cappedVault).call(abi.encodeCall(cappedVault.executeNextMarketSlice, (orderId, 1)));
        require(!ok, "market output exceeded cap");
        RhShieldedVault.MarketOrder memory order = cappedVault.getMarketOrder(orderId);
        require(order.executedInput == 0, "cap failure retained state");
    }

    function testExpiredPartialOrderReturnsPrivateRefundBacking() public {
        vault.deposit(proof(), address(token), 100 ether, bytes32(uint256(101)), bytes32(uint256(12)));
        bytes32 orderId = bytes32(uint256(504));
        uint256 deadline = block.timestamp + 31 seconds;
        vault.openMarketOrder(
            proof(),
            bytes32(uint256(12)),
            address(token),
            100 ether,
            address(quote),
            90 ether,
            orderId,
            bytes32(uint256(604)),
            deadline
        );
        vault.executeNextMarketSlice(orderId, 1);
        RhShieldedVault.MarketOrder memory order = vault.getMarketOrder(orderId);
        uint256 refund = order.amountIn - order.executedInput;

        vm.warp(deadline + 30 seconds);
        vault.settleMarketOrder(
            proof(),
            orderId,
            bytes32(uint256(12)),
            bytes32(uint256(13)),
            bytes32(uint256(703)),
            bytes32(uint256(704))
        );
        require(vault.publicReserves(address(token)) == refund, "refund backing");
        require(vault.publicReserves(address(quote)) == order.netAmountOut, "partial output backing");
        require(vault.pendingMarketReserves(address(token)) == 0, "input escrow cleared");
        require(vault.pendingMarketProceeds(address(quote)) == 0, "output escrow cleared");
    }
}
