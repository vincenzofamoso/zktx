pragma circom 2.1.6;

include "lib/merkle.circom";

template MarketOrder(levels) {
    signal input root;
    signal input nullifier;
    signal input assetIn;
    signal input amountIn;
    signal input assetOut;
    signal input minimumAmountOut;
    signal input settlementKey;
    signal input deadline;
    signal input chainId;
    signal input vaultAddress;

    signal input ownerSecret;
    signal input inputBlinding;
    signal input inputPathElements[levels];
    signal input inputPathIndices[levels];
    signal input outputOwnerPublicKey;
    signal input outputBlinding;
    signal input refundBlinding;
    signal input distinctAssetInverse;

    component owner = Poseidon(1);
    owner.inputs[0] <== ownerSecret;

    component inputNote = Poseidon(6);
    inputNote.inputs[0] <== chainId;
    inputNote.inputs[1] <== vaultAddress;
    inputNote.inputs[2] <== assetIn;
    inputNote.inputs[3] <== amountIn;
    inputNote.inputs[4] <== owner.out;
    inputNote.inputs[5] <== inputBlinding;

    component member = MerkleRoot(levels);
    member.leaf <== inputNote.out;
    for (var i = 0; i < levels; i++) {
        member.pathElements[i] <== inputPathElements[i];
        member.pathIndices[i] <== inputPathIndices[i];
    }
    member.root === root;

    component spend = Poseidon(4);
    spend.inputs[0] <== inputNote.out;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== chainId;
    spend.inputs[3] <== vaultAddress;
    spend.out === nullifier;

    component settlement = Poseidon(3);
    settlement.inputs[0] <== outputOwnerPublicKey;
    settlement.inputs[1] <== outputBlinding;
    settlement.inputs[2] <== refundBlinding;
    settlement.out === settlementKey;

    (assetIn - assetOut) * distinctAssetInverse === 1;
    signal minimumBinding;
    signal deadlineBinding;
    minimumBinding <== minimumAmountOut * minimumAmountOut;
    deadlineBinding <== deadline * deadline;
}

component main {public [root, nullifier, assetIn, amountIn, assetOut, minimumAmountOut, settlementKey, deadline, chainId, vaultAddress]} = MarketOrder(20);
