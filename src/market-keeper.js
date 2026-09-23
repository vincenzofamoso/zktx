import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./vault-abi.js";

const BPS = 10_000n;

export function minimumAfterSlippage(quotedAmount, slippageBps) {
  const quote = BigInt(quotedAmount);
  const slippage = BigInt(slippageBps);
  if (quote <= 0n || slippage < 0n || slippage >= BPS) throw new Error("Invalid buyback quote or slippage");
  const result = quote * (BPS - slippage) / BPS;
  return result > 0n ? result : 1n;
}

export function createMarketKeeper({
  rpcUrl,
  privateKey,
  vaultAddress,
  chainId = 4663,
  buybackSlippageBps = 500,
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("Invalid keeper private key");
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress || "")) throw new Error("Invalid keeper contract address");
  const chain = { id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  let running = false;

  async function simulateSlice(orderId, minimumBuybackOut) {
    return publicClient.simulateContract({
      account,
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "executeNextMarketSlice",
      args: [orderId, minimumBuybackOut],
    });
  }

  async function executeOrder(orderId) {
    let probe;
    try {
      // A minimum of one probes the complete PONS route and returns the actual
      // ZKTX amount without relying on a generation-specific V3/V4 quoter.
      probe = await simulateSlice(orderId, 1n);
    } catch (buybackProbeError) {
      try {
        probe = await simulateSlice(orderId, 0n);
      } catch {
        throw buybackProbeError;
      }
    }
    const quotedBurn = BigInt(probe.result[2]);
    const minimumBuybackOut = quotedBurn === 0n
      ? 0n
      : minimumAfterSlippage(quotedBurn, buybackSlippageBps);
    const request = await publicClient.simulateContract({
      account,
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "executeNextMarketSlice",
      args: [orderId, minimumBuybackOut],
    });
    const hash = await wallet.writeContract(request.request);
    await publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async function tick() {
    if (running) return [];
    running = true;
    const hashes = [];
    try {
      const [count, block] = await Promise.all([
        publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "marketOrderCount" }),
        publicClient.getBlock(),
      ]);
      for (let index = 0n; index < count; index += 1n) {
        const orderId = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "marketOrderIds", args: [index] });
        const order = await publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "getMarketOrder", args: [orderId] });
        if (order.settled || order.executedInput >= order.amountIn) continue;
        if (BigInt(order.deadline) < block.timestamp || BigInt(order.lastExecutionBlock) >= block.number) continue;
        try {
          hashes.push(await executeOrder(orderId));
        } catch (error) {
          console.error("market keeper order", orderId, error.shortMessage || error.message);
        }
      }
      return hashes;
    } finally {
      running = false;
    }
  }

  return { account: account.address, tick };
}
