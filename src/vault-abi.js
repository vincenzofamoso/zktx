export const vaultAbi = [
  { type: "event", name: "Deposit", inputs: [
    { indexed: true, name: "asset", type: "address" }, { indexed: false, name: "amount", type: "uint256" },
    { indexed: true, name: "commitment", type: "bytes32" }, { indexed: false, name: "newRoot", type: "bytes32" },
    { indexed: false, name: "noteIndex", type: "uint256" },
  ] },
  { type: "event", name: "PrivateTransfer", inputs: [
    { indexed: true, name: "oldRoot", type: "bytes32" }, { indexed: true, name: "newRoot", type: "bytes32" },
    { indexed: true, name: "nullifier", type: "bytes32" }, { indexed: false, name: "outputOne", type: "bytes32" },
    { indexed: false, name: "outputTwo", type: "bytes32" },
  ] },
  { type: "event", name: "Withdrawal", inputs: [
    { indexed: true, name: "asset", type: "address" }, { indexed: true, name: "recipient", type: "address" },
    { indexed: false, name: "amount", type: "uint256" }, { indexed: true, name: "nullifier", type: "bytes32" },
  ] },
  { type: "event", name: "PrivateSwap", inputs: [
    { indexed: true, name: "oldRoot", type: "bytes32" }, { indexed: true, name: "newRoot", type: "bytes32" },
    { indexed: true, name: "makerNullifier", type: "bytes32" }, { indexed: false, name: "takerNullifier", type: "bytes32" },
    { indexed: false, name: "makerOutput", type: "bytes32" }, { indexed: false, name: "takerOutput", type: "bytes32" },
    { indexed: false, name: "changeOutput", type: "bytes32" },
  ] },
  { type: "event", name: "PrivateOrderCancelled", inputs: [
    { indexed: true, name: "oldRoot", type: "bytes32" }, { indexed: true, name: "newRoot", type: "bytes32" },
    { indexed: true, name: "orderNullifier", type: "bytes32" }, { indexed: false, name: "refundCommitment", type: "bytes32" },
  ] },
  { type: "event", name: "MarketOrderOpened", inputs: [
    { indexed: true, name: "orderId", type: "bytes32" }, { indexed: true, name: "assetIn", type: "address" },
    { indexed: true, name: "assetOut", type: "address" }, { indexed: false, name: "amountIn", type: "uint256" },
    { indexed: false, name: "minimumAmountOut", type: "uint256" }, { indexed: false, name: "deadline", type: "uint256" },
    { indexed: false, name: "sliceCount", type: "uint8" }, { indexed: false, name: "settlementKey", type: "bytes32" },
  ] },
  { type: "event", name: "MarketSliceExecuted", inputs: [
    { indexed: true, name: "orderId", type: "bytes32" }, { indexed: true, name: "slice", type: "uint8" },
    { indexed: false, name: "amountIn", type: "uint256" }, { indexed: false, name: "grossAmountOut", type: "uint256" },
    { indexed: false, name: "netAmountOut", type: "uint256" }, { indexed: false, name: "executionFee", type: "uint256" },
    { indexed: false, name: "buybackFee", type: "uint256" }, { indexed: false, name: "zktxBurned", type: "uint256" },
  ] },
  { type: "event", name: "MarketOrderSettled", inputs: [
    { indexed: true, name: "orderId", type: "bytes32" }, { indexed: true, name: "outputCommitment", type: "bytes32" },
    { indexed: true, name: "refundCommitment", type: "bytes32" }, { indexed: false, name: "netAmountOut", type: "uint256" },
    { indexed: false, name: "refundAmount", type: "uint256" }, { indexed: false, name: "newRoot", type: "bytes32" },
  ] },
  { type: "function", name: "transact", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "oldRoot", type: "bytes32" }, { name: "newRoot", type: "bytes32" },
    { name: "nullifier", type: "bytes32" }, { name: "outputOne", type: "bytes32" }, { name: "outputTwo", type: "bytes32" },
  ], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "root", type: "bytes32" }, { name: "asset", type: "address" }, { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" }, { name: "nullifier", type: "bytes32" },
  ], outputs: [] },
  { type: "function", name: "settleSwap", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "oldRoot", type: "bytes32" }, { name: "newRoot", type: "bytes32" },
    { name: "makerNullifier", type: "bytes32" }, { name: "takerNullifier", type: "bytes32" },
    { name: "makerOutput", type: "bytes32" }, { name: "takerOutput", type: "bytes32" }, { name: "changeOutput", type: "bytes32" },
    { name: "deadline", type: "uint256" },
  ], outputs: [] },
  { type: "function", name: "cancelOrder", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "oldRoot", type: "bytes32" }, { name: "newRoot", type: "bytes32" },
    { name: "orderNullifier", type: "bytes32" }, { name: "refundCommitment", type: "bytes32" },
  ], outputs: [] },
  { type: "function", name: "openMarketOrder", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "root", type: "bytes32" }, { name: "assetIn", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "assetOut", type: "address" }, { name: "minimumAmountOut", type: "uint256" },
    { name: "nullifier", type: "bytes32" }, { name: "settlementKey", type: "bytes32" }, { name: "deadline", type: "uint256" },
  ], outputs: [] },
  { type: "function", name: "settleMarketOrder", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "orderId", type: "bytes32" }, { name: "oldRoot", type: "bytes32" },
    { name: "newRoot", type: "bytes32" }, { name: "outputCommitment", type: "bytes32" },
    { name: "refundCommitment", type: "bytes32" },
  ], outputs: [] },
  { type: "function", name: "executeNextMarketSlice", stateMutability: "nonpayable", inputs: [
    { name: "orderId", type: "bytes32" }, { name: "minimumBuybackOut", type: "uint256" },
  ], outputs: [
    { name: "sliceAmount", type: "uint256" }, { name: "userAmountOut", type: "uint256" },
    { name: "zktxBurned", type: "uint256" },
  ] },
  { type: "function", name: "nextMarketSliceAmount", stateMutability: "view", inputs: [
    { name: "orderId", type: "bytes32" },
  ], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "marketOrderCount", stateMutability: "view", inputs: [], outputs: [
    { name: "", type: "uint256" },
  ] },
  { type: "function", name: "marketOrderIds", stateMutability: "view", inputs: [
    { name: "", type: "uint256" },
  ], outputs: [{ name: "", type: "bytes32" }] },
  { type: "function", name: "marketQuoteAsset", stateMutability: "view", inputs: [], outputs: [
    { name: "", type: "address" },
  ] },
  { type: "function", name: "zktxToken", stateMutability: "view", inputs: [], outputs: [
    { name: "", type: "address" },
  ] },
  { type: "function", name: "getMarketOrder", stateMutability: "view", inputs: [
    { name: "orderId", type: "bytes32" },
  ], outputs: [{ name: "", type: "tuple", components: [
    { name: "assetIn", type: "address" }, { name: "assetOut", type: "address" },
    { name: "amountIn", type: "uint256" }, { name: "minimumAmountOut", type: "uint256" },
    { name: "executedInput", type: "uint256" }, { name: "grossAmountOut", type: "uint256" },
    { name: "netAmountOut", type: "uint256" }, { name: "executionFeeAmount", type: "uint256" },
    { name: "buybackFeeAmount", type: "uint256" }, { name: "zktxBurned", type: "uint256" },
    { name: "settlementKey", type: "bytes32" }, { name: "openedAt", type: "uint64" },
    { name: "deadline", type: "uint64" }, { name: "lastExecutionAt", type: "uint64" },
    { name: "lastExecutionBlock", type: "uint64" }, { name: "sliceCount", type: "uint8" },
    { name: "slicesExecuted", type: "uint8" }, { name: "settled", type: "bool" },
  ] }] },
];
