// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {
    ICancelOrderVerifier,
    IDepositVerifier,
    ISwapVerifier,
    ITransferVerifier,
    IWithdrawVerifier
} from "../contracts/IZkVerifier.sol";
import {RhShieldedVault} from "../contracts/RhShieldedVault.sol";

contract MockVerifier is
    IDepositVerifier,
    ITransferVerifier,
    IWithdrawVerifier,
    ISwapVerifier,
    ICancelOrderVerifier
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
}

contract MockToken {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 value) external {
        balanceOf[to] += value;
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

contract RhShieldedVaultTest {
    MockVerifier verifier;
    MockToken token;
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
        vault = new RhShieldedVault(address(this), verifier, verifier, verifier, verifier, verifier, ROOT);
        vault.setAssetSupported(address(token), true);
        vault.setReserveCap(address(token), 200 ether);
        token.mint(address(this), 1_000 ether);
        token.approve(address(vault), type(uint256).max);
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
}
