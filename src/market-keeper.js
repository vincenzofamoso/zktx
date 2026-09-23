import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { vaultAbi } from "./vault-abi.js";

const BPS = 10_000n;
const AGGREGATOR_ENTRY_POINT = "0x0000000000001fF3684f28c67538d4D072C22734";
const routingAbi = parseAbi(["function routeKey(address,address) pure returns (bytes32)", "function routes(bytes32) view returns (address)"]);
const marketConfigAbi = parseAbi(["function marketAdapter() view returns (address)"]);
const aggregatorAbi = parseAbi(["function prepareSwap(address,address,uint256,uint256,uint64,bytes)"]);

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
  aggregatorAdapter,
  aggregatorQuoteUrl,
}) {
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey || "")) throw new Error("Invalid keeper private key");
  if (!/^0x[0-9a-fA-F]{40}$/.test(vaultAddress || "")) throw new Error("Invalid keeper contract address");
  const chain = { id: chainId, name: "Robinhood Chain", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [rpcUrl] } } };
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
  let running = false;

  async function prepareAggregatorSlice(orderId) {
    if (!aggregatorAdapter || !aggregatorQuoteUrl) return;
    const [order, routingAdapter, sliceAmount] = await Promise.all([
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "getMarketOrder", args: [orderId] }),
      publicClient.readContract({ address: vaultAddress, abi: marketConfigAbi, functionName: "marketAdapter" }),
      publicClient.readContract({ address: vaultAddress, abi: vaultAbi, functionName: "nextMarketSliceAmount", args: [orderId] }),
    ]);
    const key = await publicClient.readContract({ address: routingAdapter, abi: routingAbi, functionName: "routeKey", args: [order.assetIn, order.assetOut] });
    const adapter = await publicClient.readContract({ address: routingAdapter, abi: routingAbi, functionName: "routes", args: [key] });
    if (adapter.toLowerCase() !== aggregatorAdapter.toLowerCase()) return;
    const nextExecuted = BigInt(order.executedInput) + BigInt(sliceAmount);
    const ceil = (value, divisor) => (value + divisor - 1n) / divisor;
    const requiredOutput = ceil(BigInt(order.minimumAmountOut) * nextExecuted, BigInt(order.amountIn))
      - ceil(BigInt(order.minimumAmountOut) * BigInt(order.executedInput), BigInt(order.amountIn));
    const response = await fetch(aggregatorQuoteUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "quote", sellToken: order.assetIn, buyToken: order.assetOut, sellAmount: String(sliceAmount), taker: aggregatorAdapter, slippageBps: 500 }),
      signal: AbortSignal.timeout(12_000),
    });
    const quote = await response.json();
    if (!response.ok || quote.liquidityAvailable !== true || !quote.transaction?.data) throw new Error(quote.error || "No executable aggregate quote");
    if (quote.transaction.to?.toLowerCase() !== AGGREGATOR_ENTRY_POINT.toLowerCase()) {
      throw new Error("Aggregate quote returned an untrusted execution target");
    }
    if (quote.issues?.allowance?.spender && quote.issues.allowance.spender.toLowerCase() !== AGGREGATOR_ENTRY_POINT.toLowerCase()) {
      throw new Error("Aggregate quote returned an untrusted allowance target");
    }
    if (BigInt(quote.buyAmount || 0) < requiredOutput) throw new Error("Aggregate quote is below the order minimum");
    const request = await publicClient.simulateContract({
      account,
      address: aggregatorAdapter,
      abi: aggregatorAbi,
      functionName: "prepareSwap",
      args: [order.assetIn, order.assetOut, BigInt(sliceAmount), requiredOutput, BigInt(Math.floor(Date.now() / 1000) + 90), quote.transaction.data],
    });
    const hash = await wallet.writeContract(request.request);
    await publicClient.waitForTransactionReceipt({ hash });
  }

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
    await prepareAggregatorSlice(orderId);
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
