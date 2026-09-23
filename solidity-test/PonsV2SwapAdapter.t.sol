// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    IWrappedNativeForPonsV2Adapter,
    IPonsV2FactoryForAdapter,
    IPonsV4PoolManagerForAdapter,
    PonsV2SwapAdapter
} from "../contracts/PonsV2SwapAdapter.sol";

interface VmPonsV2 {
    function deal(address account, uint256 balance) external;
}

contract V2TestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function burn(address from, uint256 amount) external {
        balanceOf[from] -= amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract V2TestWrappedNative is V2TestToken {
    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function withdraw(uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok,) = payable(msg.sender).call{value: amount}("");
        require(ok, "native transfer");
    }

    receive() external payable {}
}

contract MockPonsV2Factory is IPonsV2FactoryForAdapter {
    address public poolManager;
    address public memeHook;
    mapping(address => LaunchedToken) internal launches;

    constructor(address manager, address hook) {
        poolManager = manager;
        memeHook = hook;
    }

    function setLaunch(address token, address curve, address pairToken, GraduationPhase phase) external {
        launches[token] = LaunchedToken({
            token: token,
            curve: curve,
            deployer: address(1),
            creatorFeeRecipient: address(2),
            pairToken: pairToken,
            graduationThreshold: 1,
            poolFee: 10_000,
            tickSpacing: 200,
            creatorTaxBps: 0,
            buybackEnabled: false,
            phase: phase,
            sweptQuote: 0,
            sweptTokens: 0,
            sweptAt: 0,
            exists: true
        });
    }

    function getLaunchedToken(address token) external view returns (LaunchedToken memory) {
        return launches[token];
    }

    function graduate(address token) external {
        require(launches[token].phase == GraduationPhase.NotGraduated, "phase");
        launches[token].phase = GraduationPhase.Swept;
    }

    function createGraduatedPool(address token) external returns (uint256 positionId) {
        require(launches[token].phase == GraduationPhase.Swept, "phase");
        launches[token].phase = GraduationPhase.PoolCreated;
        return 1;
    }
}

contract MockPonsV2Curve {
    V2TestToken public immutable token;
    V2TestToken public immutable pair;
    bool public immutable nativePair;
    bool public ready;

    constructor(V2TestToken token_, V2TestToken pair_, bool nativePair_) {
        token = token_;
        pair = pair_;
        nativePair = nativePair_;
    }

    function setReady(bool value) external {
        ready = value;
    }

    function readyToGraduate() external view returns (bool) {
        return ready;
    }

    function buy(uint256 quoteIn, uint256 minTokensOut, address recipient)
        external
        payable
        virtual
        returns (uint256 tokensOut)
    {
        if (nativePair) require(msg.value == quoteIn, "native quote");
        else require(pair.transferFrom(msg.sender, address(this), quoteIn), "pair transfer");
        tokensOut = quoteIn;
        require(tokensOut >= minTokensOut, "minimum");
        token.mint(recipient, tokensOut);
    }

    function sell(uint256 tokensIn, uint256 minQuoteOut, address recipient)
        external
        returns (uint256 quoteOut)
    {
        require(token.transferFrom(msg.sender, address(this), tokensIn), "token transfer");
        quoteOut = tokensIn;
        require(quoteOut >= minQuoteOut, "minimum");
        if (nativePair) {
            (bool ok,) = payable(recipient).call{value: quoteOut}("");
            require(ok, "native payout");
        } else {
            pair.mint(recipient, quoteOut);
        }
    }

    receive() external payable {}
}

contract MockPartialPonsV2Curve is MockPonsV2Curve {
    constructor(V2TestToken token_, V2TestToken pair_) MockPonsV2Curve(token_, pair_, true) {}

    function buy(uint256 quoteIn, uint256, address recipient)
        external
        payable
        override
        returns (uint256 tokensOut)
    {
        require(msg.value == quoteIn, "native quote");
        uint256 spent = quoteIn / 2;
        tokensOut = spent;
        token.mint(recipient, tokensOut);
        (bool ok,) = payable(msg.sender).call{value: quoteIn - spent}("");
        require(ok, "refund");
    }
}

contract MockPonsV4Manager is IPonsV4PoolManagerForAdapter {
    uint256 public outputNumerator = 2;
    address private syncedCurrency;

    function unlock(bytes calldata data) external returns (bytes memory result) {
        (bool ok, bytes memory returned) = msg.sender.call(abi.encodeWithSignature("unlockCallback(bytes)", data));
        require(ok, "callback");
        return abi.decode(returned, (bytes));
    }

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata)
        external
        view
        returns (int256 delta)
    {
        uint256 input = uint256(-params.amountSpecified);
        uint256 output = input * outputNumerator;
        int128 amount0 = params.zeroForOne ? -int128(int256(input)) : int128(int256(output));
        int128 amount1 = params.zeroForOne ? int128(int256(output)) : -int128(int256(input));
        delta = (int256(amount0) << 128) | int256(uint256(uint128(amount1)));
        require(key.hooks != address(0), "hook");
    }

    function sync(address currency) external {
        syncedCurrency = currency;
    }

    function settle() external payable returns (uint256 paid) {
        if (syncedCurrency != address(0)) return 0;
        return msg.value;
    }

    function take(address currency, address to, uint256 amount) external {
        if (currency == address(0)) {
            (bool ok,) = payable(to).call{value: amount}("");
            require(ok, "native take");
        } else {
            V2TestToken(currency).mint(to, amount);
        }
    }

    receive() external payable {}
}

contract PonsV2SwapAdapterTest {
    VmPonsV2 constant vm = VmPonsV2(address(uint160(uint256(keccak256("hevm cheat code")))));
    V2TestWrappedNative weth;
    V2TestToken token;
    MockPonsV4Manager manager;
    MockPonsV2Factory factory;

    function setUp() public {
        weth = new V2TestWrappedNative();
        token = new V2TestToken();
        manager = new MockPonsV4Manager();
        factory = new MockPonsV2Factory(address(manager), address(0x1234));
        vm.deal(address(this), 100 ether);
        vm.deal(address(manager), 100 ether);
    }

    function testRoutesNativeLaunchThroughBondingCurve() public {
        MockPonsV2Curve curve = new MockPonsV2Curve(token, weth, true);
        vm.deal(address(curve), 100 ether);
        factory.setLaunch(address(token), address(curve), address(0), IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated);
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(weth), IWrappedNativeForPonsV2Adapter(address(weth))
        );

        weth.deposit{value: 10 ether}();
        weth.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(weth), address(token), 10 ether, 9 ether, address(this));
        require(bought == 10 ether && token.balanceOf(address(this)) == 10 ether, "curve buy");

        token.approve(address(adapter), type(uint256).max);
        uint256 sold = adapter.swapExactInput(address(token), address(weth), 4 ether, 3 ether, address(this));
        require(sold == 4 ether && weth.balanceOf(address(this)) == 4 ether, "curve sell");
    }

    function testRoutesGraduatedNativeLaunchThroughV4() public {
        MockPonsV2Curve curve = new MockPonsV2Curve(token, weth, true);
        factory.setLaunch(address(token), address(curve), address(0), IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated);
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(weth), IWrappedNativeForPonsV2Adapter(address(weth))
        );

        weth.deposit{value: 10 ether}();
        weth.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(weth), address(token), 5 ether, 9 ether, address(this));
        require(bought == 10 ether && token.balanceOf(address(this)) == 10 ether, "v4 buy");

        token.approve(address(adapter), type(uint256).max);
        uint256 sold = adapter.swapExactInput(address(token), address(weth), 2 ether, 3 ether, address(this));
        require(sold == 4 ether && weth.balanceOf(address(this)) == 9 ether, "v4 sell");
    }

    function testRoutesErc20QuotedLaunchThroughCurve() public {
        V2TestToken stable = new V2TestToken();
        MockPonsV2Curve curve = new MockPonsV2Curve(token, stable, false);
        factory.setLaunch(
            address(token),
            address(curve),
            address(stable),
            IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated
        );
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(stable), IWrappedNativeForPonsV2Adapter(address(weth))
        );
        stable.mint(address(this), 10 ether);
        stable.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(stable), address(token), 5 ether, 5 ether, address(this));
        require(bought == 5 ether && token.balanceOf(address(this)) == 5 ether, "erc20 curve buy");
    }

    function testCompletesGraduationAndRoutesCurveRefundThroughV4() public {
        MockPartialPonsV2Curve curve = new MockPartialPonsV2Curve(token, weth);
        factory.setLaunch(
            address(token),
            address(curve),
            address(0),
            IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated
        );
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(weth), IWrappedNativeForPonsV2Adapter(address(weth))
        );
        weth.deposit{value: 10 ether}();
        weth.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(weth), address(token), 10 ether, 14 ether, address(this));
        require(bought == 15 ether && token.balanceOf(address(this)) == 15 ether, "combined output");
        IPonsV2FactoryForAdapter.LaunchedToken memory launch = factory.getLaunchedToken(address(token));
        require(launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated, "graduated");
    }

    function testCompletesExistingSweptGraduationBeforeTrading() public {
        MockPonsV2Curve curve = new MockPonsV2Curve(token, weth, true);
        factory.setLaunch(address(token), address(curve), address(0), IPonsV2FactoryForAdapter.GraduationPhase.Swept);
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(weth), IWrappedNativeForPonsV2Adapter(address(weth))
        );
        weth.deposit{value: 1 ether}();
        weth.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(weth), address(token), 1 ether, 1 ether, address(this));
        require(bought == 2 ether, "swept output");
        IPonsV2FactoryForAdapter.LaunchedToken memory launch = factory.getLaunchedToken(address(token));
        require(launch.phase == IPonsV2FactoryForAdapter.GraduationPhase.PoolCreated, "pool not created");
    }

    function testGraduatesReadyCurveBeforeTrading() public {
        MockPonsV2Curve curve = new MockPonsV2Curve(token, weth, true);
        curve.setReady(true);
        factory.setLaunch(
            address(token),
            address(curve),
            address(0),
            IPonsV2FactoryForAdapter.GraduationPhase.NotGraduated
        );
        PonsV2SwapAdapter adapter = new PonsV2SwapAdapter(
            factory, address(weth), IWrappedNativeForPonsV2Adapter(address(weth))
        );
        weth.deposit{value: 1 ether}();
        weth.approve(address(adapter), type(uint256).max);
        uint256 bought = adapter.swapExactInput(address(weth), address(token), 1 ether, 1 ether, address(this));
        require(bought == 2 ether, "ready output");
    }
}
