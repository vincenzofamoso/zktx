import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./vault-abi.js";

const bytes32 = /^0x[0-9a-fA-F]{64}$/;
const address = /^0x[0-9a-fA-F]{40}$/;
const bytes = /^0x(?:[0-9a-fA-F]{2})+$/;

export function createRelayer({ rpcUrl, privateKey, vaultAddress, chainId = 4663 }) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) throw new Error("Invalid relayer private key");
  const chain = { id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
  const account = privateKeyToAccount(privateKey);
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });

  async function relay(payload) {
    if (!payload || !bytes.test(payload.proof || "")) throw new Error("Invalid proof encoding");
    let functionName;
    let args;
    if (payload.action === "transfer") {
      for (const key of ["oldRoot", "newRoot", "nullifier", "outputOne", "outputTwo"]) if (!bytes32.test(payload[key] || "")) throw new Error(`Invalid ${key}`);
      functionName = "transact";
      args = [payload.proof, payload.oldRoot, payload.newRoot, payload.nullifier, payload.outputOne, payload.outputTwo];
    } else if (payload.action === "swap") {
      for (const key of ["oldRoot", "newRoot", "makerNullifier", "takerNullifier", "makerOutput", "takerOutput", "changeOutput"]) if (!bytes32.test(payload[key] || "")) throw new Error(`Invalid ${key}`);
      const deadline = BigInt(payload.deadline);
      if (deadline <= BigInt(Math.floor(Date.now() / 1000))) throw new Error("Swap quote expired");
      functionName = "settleSwap";
      args = [payload.proof, payload.oldRoot, payload.newRoot, payload.makerNullifier, payload.takerNullifier, payload.makerOutput, payload.takerOutput, payload.changeOutput, deadline];
    } else if (payload.action === "cancel-order") {
      for (const key of ["oldRoot", "newRoot", "orderNullifier", "refundCommitment"]) if (!bytes32.test(payload[key] || "")) throw new Error(`Invalid ${key}`);
      functionName = "cancelOrder";
      args = [payload.proof, payload.oldRoot, payload.newRoot, payload.orderNullifier, payload.refundCommitment];
    } else if (payload.action === "market-order") {
      for (const key of ["root", "nullifier", "settlementKey"]) if (!bytes32.test(payload[key] || "")) throw new Error(`Invalid ${key}`);
      if (!address.test(payload.assetIn || "") || !address.test(payload.assetOut || "")) throw new Error("Invalid market assets");
      const amountIn = BigInt(payload.amountIn);
      const minimumAmountOut = BigInt(payload.minimumAmountOut);
      const deadline = BigInt(payload.deadline);
      if (amountIn <= 0n || minimumAmountOut <= 0n) throw new Error("Invalid market amounts");
      if (deadline <= BigInt(Math.floor(Date.now() / 1000)) + 30n) throw new Error("Market order deadline is too soon");
      functionName = "openMarketOrder";
      args = [payload.proof, payload.root, payload.assetIn, amountIn, payload.assetOut, minimumAmountOut, payload.nullifier, payload.settlementKey, deadline];
    } else if (payload.action === "market-settlement") {
      for (const key of ["orderId", "oldRoot", "newRoot", "outputCommitment", "refundCommitment"]) if (!bytes32.test(payload[key] || "")) throw new Error(`Invalid ${key}`);
      functionName = "settleMarketOrder";
      args = [payload.proof, payload.orderId, payload.oldRoot, payload.newRoot, payload.outputCommitment, payload.refundCommitment];
    } else if (payload.action === "withdraw") {
      if (!bytes32.test(payload.root || "") || !address.test(payload.asset || "") || !address.test(payload.recipient || "") || !bytes32.test(payload.nullifier || "")) throw new Error("Invalid withdrawal fields");
      const amount = BigInt(payload.amount);
      if (amount <= 0n) throw new Error("Invalid amount");
      functionName = "withdraw";
      args = [payload.proof, payload.root, payload.asset, payload.recipient, amount, payload.nullifier];
    } else throw new Error("Unsupported relay action");

    const request = await publicClient.simulateContract({ account, address: vaultAddress, abi: vaultAbi, functionName, args });
    return wallet.writeContract(request.request);
  }
  return { account: account.address, relay };
}
