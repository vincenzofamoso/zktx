// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IUniswapV3SwapRouter, PonsV3SwapAdapter} from "../contracts/PonsV3SwapAdapter.sol";

contract AdapterTestToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract MockV3Router is IUniswapV3SwapRouter {
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut)
    {
        require(params.fee == 10_000, "fee");
        require(params.deadline == block.timestamp, "deadline");
        require(
            AdapterTestToken(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn),
            "input transfer"
        );
        amountOut = params.amountIn;
        require(amountOut >= params.amountOutMinimum, "minimum");
        AdapterTestToken(params.tokenOut).mint(params.recipient, amountOut);
    }
}

contract PonsV3SwapAdapterTest {
    AdapterTestToken quote;
    AdapterTestToken token;
    AdapterTestToken unrelated;
    MockV3Router router;
    PonsV3SwapAdapter adapter;

    function setUp() public {
        quote = new AdapterTestToken();
        token = new AdapterTestToken();
        unrelated = new AdapterTestToken();
        router = new MockV3Router();
        adapter = new PonsV3SwapAdapter(router, address(quote), 10_000);
        quote.mint(address(this), 100 ether);
        quote.approve(address(adapter), type(uint256).max);
        unrelated.mint(address(this), 100 ether);
        unrelated.approve(address(adapter), type(uint256).max);
    }

    function testExecutesWethQuotedSingleHop() public {
        uint256 amountOut =
            adapter.swapExactInput(address(quote), address(token), 10 ether, 9 ether, address(this));
        require(amountOut == 10 ether, "amount out");
        require(token.balanceOf(address(this)) == 10 ether, "recipient output");
    }

    function testRejectsPairWithoutQuoteAsset() public {
        (bool ok,) = address(adapter)
            .call(
                abi.encodeCall(
                    adapter.swapExactInput, (address(unrelated), address(token), 10 ether, 1, address(this))
                )
            );
        require(!ok, "unsupported pair accepted");
    }
}
