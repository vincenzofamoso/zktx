import { createPublicClient, http } from "viem";
import { vaultAbi } from "./vault-abi.js";

export function createIndexer({ rpcUrl, vaultAddress, store, startBlock = 0n }) {
  const client = createPublicClient({ transport: http(rpcUrl) });
  let running = false;

  async function sync() {
    if (running) return;
    running = true;
    try {
      const latest = await client.getBlockNumber();
      const fromBlock = store.state.lastBlock ? BigInt(store.state.lastBlock + 1) : startBlock;
      if (fromBlock > latest) return;
      const logs = await client.getContractEvents({ address: vaultAddress, abi: vaultAbi, fromBlock, toBlock: latest, strict: true });
      for (const log of logs) {
        if (log.eventName === "Deposit") await store.recordCommitment(BigInt(log.args.commitment), log.blockNumber);
        if (log.eventName === "PrivateTransfer") {
          await store.recordNullifier(BigInt(log.args.nullifier), log.blockNumber);
          await store.recordCommitment(BigInt(log.args.outputOne), log.blockNumber);
          await store.recordCommitment(BigInt(log.args.outputTwo), log.blockNumber);
        }
        if (log.eventName === "Withdrawal") await store.recordNullifier(BigInt(log.args.nullifier), log.blockNumber);
      }
      store.state.lastBlock = Number(latest);
      await store.save();
    } finally { running = false; }
  }

  return { client, sync };
}
