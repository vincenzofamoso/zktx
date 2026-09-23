// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ISwapAdapter} from "../contracts/ISwapAdapter.sol";
import {RhRoutingSwapAdapter} from "../contracts/RhRoutingSwapAdapter.sol";

interface VmRouting {
    function warp(uint256) external;
}

contract RoutingToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
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

contract VenueAdapter is ISwapAdapter {
    RoutingToken public immutable output;
    bool public lie;

    constructor(RoutingToken output_) {
        output = output_;
    }

    function setLie(bool value) external {
        lie = value;
    }

    function swapExactInput(
        address tokenIn,
        address,
        uint256 amountIn,
        uint256 minimumAmountOut,
        address recipient
    ) external returns (uint256 amountOut) {
        RoutingToken(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        amountOut = amountIn * 2;
        require(amountOut >= minimumAmountOut, "minimum");
        output.mint(recipient, amountOut);
        if (lie) amountOut += 1;
    }
}

contract RoutingOwnerActor {
    function accept(RhRoutingSwapAdapter adapter) external {
        adapter.acceptOwnership();
    }

    function disable(RhRoutingSwapAdapter adapter, address tokenIn, address tokenOut) external {
        adapter.disableRoute(tokenIn, tokenOut);
    }
}

contract RhRoutingSwapAdapterTest {
    VmRouting private constant vm = VmRouting(address(uint160(uint256(keccak256("hevm cheat code")))));
    RoutingToken input;
    RoutingToken output;
    VenueAdapter venue;
    RhRoutingSwapAdapter router;

    function setUp() public {
        input = new RoutingToken();
        output = new RoutingToken();
        venue = new VenueAdapter(output);
        router = new RhRoutingSwapAdapter(address(this), 0);
        router.proposeRoute(address(input), address(output), address(venue));
        router.activateRoute(address(input), address(output));
        input.mint(address(this), 100 ether);
        input.approve(address(router), type(uint256).max);
    }

    function testRoutesExactPairAndClearsApproval() public {
        uint256 amountOut =
            router.swapExactInput(address(input), address(output), 10 ether, 19 ether, address(this));
        require(amountOut == 20 ether, "output");
        require(output.balanceOf(address(this)) == 20 ether, "recipient");
        require(input.allowance(address(router), address(venue)) == 0, "approval");
        require(input.balanceOf(address(router)) == 0, "router dust");
    }

    function testRejectsUnapprovedReverseRoute() public {
        (bool ok,) = address(router)
            .call(
                abi.encodeCall(router.swapExactInput, (address(output), address(input), 1, 1, address(this)))
            );
        require(!ok, "reverse route accepted");
    }

    function testRejectsDishonestAdapterAccounting() public {
        venue.setLie(true);
        (bool ok,) = address(router)
            .call(
                abi.encodeCall(
                    router.swapExactInput, (address(input), address(output), 1 ether, 1, address(this))
                )
            );
        require(!ok, "dishonest output accepted");
    }

    function testImmediateDisableAndTwoStepOwnership() public {
        router.disableRoute(address(input), address(output));
        require(router.routes(router.routeKey(address(input), address(output))) == address(0), "route active");
        RoutingOwnerActor next = new RoutingOwnerActor();
        router.transferOwnership(address(next));
        next.accept(router);
        require(router.owner() == address(next), "owner");
    }

    function testRouteActivationHonorsDelay() public {
        RhRoutingSwapAdapter delayed = new RhRoutingSwapAdapter(address(this), 1 days);
        delayed.proposeRoute(address(input), address(output), address(venue));
        (bool early,) =
            address(delayed).call(abi.encodeCall(delayed.activateRoute, (address(input), address(output))));
        require(!early, "route activated early");
        vm.warp(block.timestamp + 1 days);
        delayed.activateRoute(address(input), address(output));
        require(
            delayed.routes(delayed.routeKey(address(input), address(output))) == address(venue),
            "route missing"
        );
    }
}
