pragma circom 2.1.6;

include "lib/merkle.circom";

template CancelOrder(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input orderNullifier;
    signal input refundCommitment;
    signal input refundIndex;
    signal input chainId;
    signal input vaultAddress;

    signal input cancelSecret;
    signal input orderNonce;
    signal input sellAsset;
    signal input sellAmount;
    signal input buyAsset;
    signal input buyAmount;
    signal input makerReceiveOwner;
    signal input deadline;
    signal input makerOrderBlinding;
    signal input makerPathElements[levels];
    signal input makerPathIndices[levels];
    signal input refundOwner;
    signal input refundBlinding;
    signal input insertionElements[levels];
    signal input insertionIndices[levels];

    component cancelPublic = Poseidon(1);
    cancelPublic.inputs[0] <== cancelSecret;
    component orderOwner = Poseidon(6);
    orderOwner.inputs[0] <== buyAsset;
    orderOwner.inputs[1] <== buyAmount;
    orderOwner.inputs[2] <== makerReceiveOwner;
    orderOwner.inputs[3] <== deadline;
    orderOwner.inputs[4] <== orderNonce;
    orderOwner.inputs[5] <== cancelPublic.out;

    component makerNote = Poseidon(6);
    makerNote.inputs[0] <== chainId;
    makerNote.inputs[1] <== vaultAddress;
    makerNote.inputs[2] <== sellAsset;
    makerNote.inputs[3] <== sellAmount;
    makerNote.inputs[4] <== orderOwner.out;
    makerNote.inputs[5] <== makerOrderBlinding;

    component member = MerkleRoot(levels);
    member.leaf <== makerNote.out;
    for (var i = 0; i < levels; i++) {
        member.pathElements[i] <== makerPathElements[i];
        member.pathIndices[i] <== makerPathIndices[i];
    }
    member.root === oldRoot;

    component spend = Poseidon(4);
    spend.inputs[0] <== makerNote.out;
    spend.inputs[1] <== orderOwner.out;
    spend.inputs[2] <== chainId;
    spend.inputs[3] <== vaultAddress;
    spend.out === orderNullifier;

    component refund = Poseidon(6);
    refund.inputs[0] <== chainId;
    refund.inputs[1] <== vaultAddress;
    refund.inputs[2] <== sellAsset;
    refund.inputs[3] <== sellAmount;
    refund.inputs[4] <== refundOwner;
    refund.inputs[5] <== refundBlinding;
    refund.out === refundCommitment;

    component empty = MerkleRoot(levels);
    component inserted = MerkleRoot(levels);
    component index = IndexBits(levels);
    empty.leaf <== 0;
    inserted.leaf <== refundCommitment;
    for (var j = 0; j < levels; j++) {
        empty.pathElements[j] <== insertionElements[j];
        empty.pathIndices[j] <== insertionIndices[j];
        inserted.pathElements[j] <== insertionElements[j];
        inserted.pathIndices[j] <== insertionIndices[j];
        index.bits[j] <== insertionIndices[j];
    }
    empty.root === oldRoot;
    inserted.root === newRoot;
    index.index === refundIndex;
}

component main {public [oldRoot, newRoot, orderNullifier, refundCommitment, refundIndex, chainId, vaultAddress]} = CancelOrder(20);
