// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorSwapAdapter} from "../contracts/AggregatorSwapAdapter.sol";

contract MockAggregatorToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
    function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
    function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
    function transferFrom(address from, address to, uint256 amount) external returns (bool) { allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}

contract MockAggregationEntryPoint {
    function execute(address input, address output, uint256 amountIn, uint256 amountOut) external {
        MockAggregatorToken(input).transferFrom(msg.sender, address(this), amountIn);
        MockAggregatorToken(output).transfer(msg.sender, amountOut);
    }
}

contract MockTrustedRouter {
    function execute(AggregatorSwapAdapter adapter, address input, address output, uint256 amountIn, uint256 minimum, address recipient) external returns (uint256) {
        MockAggregatorToken(input).approve(address(adapter), amountIn);
        return adapter.swapExactInput(input, output, amountIn, minimum, recipient);
    }
}

contract AggregatorSwapAdapterTest {
    function testPreparedQuoteExecutesAndMeasuresOutput() external {
        MockAggregatorToken input = new MockAggregatorToken();
        MockAggregatorToken output = new MockAggregatorToken();
        MockAggregationEntryPoint entry = new MockAggregationEntryPoint();
        MockTrustedRouter router = new MockTrustedRouter();
        AggregatorSwapAdapter adapter = new AggregatorSwapAdapter(address(router), address(entry), address(this));
        input.mint(address(router), 10 ether);
        output.mint(address(entry), 25 ether);
        bytes memory data = abi.encodeCall(entry.execute, (address(input), address(output), 10 ether, 25 ether));
        adapter.prepareSwap(address(input), address(output), 10 ether, 24 ether, uint64(block.timestamp + 60), data);
        uint256 received = router.execute(adapter, address(input), address(output), 10 ether, 24 ether, address(this));
        require(received == 25 ether, "wrong output");
        require(output.balanceOf(address(this)) == 25 ether, "recipient not paid");
    }

    function testRejectsUnpreparedSwap() external {
        MockAggregatorToken input = new MockAggregatorToken();
        MockAggregatorToken output = new MockAggregatorToken();
        MockAggregationEntryPoint entry = new MockAggregationEntryPoint();
        MockTrustedRouter router = new MockTrustedRouter();
        AggregatorSwapAdapter adapter = new AggregatorSwapAdapter(address(router), address(entry), address(this));
        input.mint(address(router), 1 ether);
        try router.execute(adapter, address(input), address(output), 1 ether, 1, address(this)) {
            revert("expected revert");
        } catch {}
    }
}
