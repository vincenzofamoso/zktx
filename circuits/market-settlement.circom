pragma circom 2.1.6;

include "lib/merkle.circom";

template MarketSettlement(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input outputCommitment;
    signal input refundCommitment;
    signal input outputIndex;
    signal input refundIndex;
    signal input settlementKey;
    signal input assetOut;
    signal input netAmountOut;
    signal input assetIn;
    signal input refundAmount;
    signal input chainId;
    signal input vaultAddress;
    signal input orderNullifier;

    signal input outputOwnerPublicKey;
    signal input outputBlinding;
    signal input refundBlinding;
    signal input outputInsertionElements[levels];
    signal input outputInsertionIndices[levels];
    signal input refundInsertionElements[levels];
    signal input refundInsertionIndices[levels];

    component settlement = Poseidon(3);
    settlement.inputs[0] <== outputOwnerPublicKey;
    settlement.inputs[1] <== outputBlinding;
    settlement.inputs[2] <== refundBlinding;
    settlement.out === settlementKey;

    component outputNote = Poseidon(6);
    outputNote.inputs[0] <== chainId;
    outputNote.inputs[1] <== vaultAddress;
    outputNote.inputs[2] <== assetOut;
    outputNote.inputs[3] <== netAmountOut;
    outputNote.inputs[4] <== outputOwnerPublicKey;
    outputNote.inputs[5] <== outputBlinding;
    outputNote.out === outputCommitment;

    component refundNote = Poseidon(6);
    refundNote.inputs[0] <== chainId;
    refundNote.inputs[1] <== vaultAddress;
    refundNote.inputs[2] <== assetIn;
    refundNote.inputs[3] <== refundAmount;
    refundNote.inputs[4] <== outputOwnerPublicKey;
    refundNote.inputs[5] <== refundBlinding;
    refundNote.out === refundCommitment;

    component emptyOutput = MerkleRoot(levels);
    component insertedOutput = MerkleRoot(levels);
    component outputIndexBits = IndexBits(levels);
    emptyOutput.leaf <== 0;
    insertedOutput.leaf <== outputCommitment;
    for (var i = 0; i < levels; i++) {
        emptyOutput.pathElements[i] <== outputInsertionElements[i];
        emptyOutput.pathIndices[i] <== outputInsertionIndices[i];
        insertedOutput.pathElements[i] <== outputInsertionElements[i];
        insertedOutput.pathIndices[i] <== outputInsertionIndices[i];
        outputIndexBits.bits[i] <== outputInsertionIndices[i];
    }
    emptyOutput.root === oldRoot;
    outputIndexBits.index === outputIndex;

    component emptyRefund = MerkleRoot(levels);
    component insertedRefund = MerkleRoot(levels);
    component refundIndexBits = IndexBits(levels);
    emptyRefund.leaf <== 0;
    insertedRefund.leaf <== refundCommitment;
    for (var j = 0; j < levels; j++) {
        emptyRefund.pathElements[j] <== refundInsertionElements[j];
        emptyRefund.pathIndices[j] <== refundInsertionIndices[j];
        insertedRefund.pathElements[j] <== refundInsertionElements[j];
        insertedRefund.pathIndices[j] <== refundInsertionIndices[j];
        refundIndexBits.bits[j] <== refundInsertionIndices[j];
    }
    emptyRefund.root === insertedOutput.root;
    insertedRefund.root === newRoot;
    refundIndexBits.index === refundIndex;

    component orderBinding = Poseidon(2);
    orderBinding.inputs[0] <== orderNullifier;
    orderBinding.inputs[1] <== settlementKey;
    signal orderBindingSquared;
    orderBindingSquared <== orderBinding.out * orderBinding.out;
}

component main {public [oldRoot, newRoot, outputCommitment, refundCommitment, outputIndex, refundIndex, settlementKey, assetOut, netAmountOut, assetIn, refundAmount, chainId, vaultAddress, orderNullifier]} = MarketSettlement(20);
