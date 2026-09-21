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
  { type: "function", name: "transact", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "oldRoot", type: "bytes32" }, { name: "newRoot", type: "bytes32" },
    { name: "nullifier", type: "bytes32" }, { name: "outputOne", type: "bytes32" }, { name: "outputTwo", type: "bytes32" },
  ], outputs: [] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [
    { name: "proof", type: "bytes" }, { name: "root", type: "bytes32" }, { name: "asset", type: "address" }, { name: "recipient", type: "address" },
    { name: "amount", type: "uint256" }, { name: "nullifier", type: "bytes32" },
  ], outputs: [] },
];
