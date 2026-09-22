pragma circom 2.1.6;

include "lib/merkle.circom";

template PrivateRfqSwap(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input makerNullifier;
    signal input takerNullifier;
    signal input makerOutputCommitment;
    signal input takerOutputCommitment;
    signal input changeCommitment;
    signal input makerOutputIndex;
    signal input takerOutputIndex;
    signal input changeIndex;
    signal input chainId;
    signal input vaultAddress;
    signal input deadline;

    signal input cancelPublicKey;
    signal input orderNonce;
    signal input sellAsset;
    signal input sellAmount;
    signal input buyAsset;
    signal input buyAmount;
    signal input makerReceiveOwner;
    signal input makerOrderBlinding;
    signal input makerPathElements[levels];
    signal input makerPathIndices[levels];

    signal input takerOwnerSecret;
    signal input takerInputAmount;
    signal input takerInputBlinding;
    signal input takerPathElements[levels];
    signal input takerPathIndices[levels];

    signal input takerReceiveOwner;
    signal input makerOutputBlinding;
    signal input takerOutputBlinding;
    signal input changeOwner;
    signal input changeAmount;
    signal input changeBlinding;
    signal input distinctNullifierInverse;

    signal input makerInsertionElements[levels];
    signal input makerInsertionIndices[levels];
    signal input takerInsertionElements[levels];
    signal input takerInsertionIndices[levels];
    signal input changeInsertionElements[levels];
    signal input changeInsertionIndices[levels];

    component orderOwner = Poseidon(6);
    orderOwner.inputs[0] <== buyAsset;
    orderOwner.inputs[1] <== buyAmount;
    orderOwner.inputs[2] <== makerReceiveOwner;
    orderOwner.inputs[3] <== deadline;
    orderOwner.inputs[4] <== orderNonce;
    orderOwner.inputs[5] <== cancelPublicKey;

    component makerNote = Poseidon(6);
    makerNote.inputs[0] <== chainId;
    makerNote.inputs[1] <== vaultAddress;
    makerNote.inputs[2] <== sellAsset;
    makerNote.inputs[3] <== sellAmount;
    makerNote.inputs[4] <== orderOwner.out;
    makerNote.inputs[5] <== makerOrderBlinding;

    component makerMember = MerkleRoot(levels);
    makerMember.leaf <== makerNote.out;
    for (var i = 0; i < levels; i++) {
        makerMember.pathElements[i] <== makerPathElements[i];
        makerMember.pathIndices[i] <== makerPathIndices[i];
    }
    makerMember.root === oldRoot;

    component makerSpend = Poseidon(4);
    makerSpend.inputs[0] <== makerNote.out;
    makerSpend.inputs[1] <== orderOwner.out;
    makerSpend.inputs[2] <== chainId;
    makerSpend.inputs[3] <== vaultAddress;
    makerSpend.out === makerNullifier;

    component takerOwner = Poseidon(1);
    takerOwner.inputs[0] <== takerOwnerSecret;
    component takerInput = Poseidon(6);
    takerInput.inputs[0] <== chainId;
    takerInput.inputs[1] <== vaultAddress;
    takerInput.inputs[2] <== buyAsset;
    takerInput.inputs[3] <== takerInputAmount;
    takerInput.inputs[4] <== takerOwner.out;
    takerInput.inputs[5] <== takerInputBlinding;

    component takerMember = MerkleRoot(levels);
    takerMember.leaf <== takerInput.out;
    for (var j = 0; j < levels; j++) {
        takerMember.pathElements[j] <== takerPathElements[j];
        takerMember.pathIndices[j] <== takerPathIndices[j];
    }
    takerMember.root === oldRoot;

    component takerSpend = Poseidon(4);
    takerSpend.inputs[0] <== takerInput.out;
    takerSpend.inputs[1] <== takerOwnerSecret;
    takerSpend.inputs[2] <== chainId;
    takerSpend.inputs[3] <== vaultAddress;
    takerSpend.out === takerNullifier;
    (makerNullifier - takerNullifier) * distinctNullifierInverse === 1;
    takerInputAmount === buyAmount + changeAmount;

    component makerOutput = Poseidon(6);
    makerOutput.inputs[0] <== chainId;
    makerOutput.inputs[1] <== vaultAddress;
    makerOutput.inputs[2] <== buyAsset;
    makerOutput.inputs[3] <== buyAmount;
    makerOutput.inputs[4] <== makerReceiveOwner;
    makerOutput.inputs[5] <== makerOutputBlinding;
    makerOutput.out === makerOutputCommitment;

    component takerOutput = Poseidon(6);
    takerOutput.inputs[0] <== chainId;
    takerOutput.inputs[1] <== vaultAddress;
    takerOutput.inputs[2] <== sellAsset;
    takerOutput.inputs[3] <== sellAmount;
    takerOutput.inputs[4] <== takerReceiveOwner;
    takerOutput.inputs[5] <== takerOutputBlinding;
    takerOutput.out === takerOutputCommitment;

    component changeOutput = Poseidon(6);
    changeOutput.inputs[0] <== chainId;
    changeOutput.inputs[1] <== vaultAddress;
    changeOutput.inputs[2] <== buyAsset;
    changeOutput.inputs[3] <== changeAmount;
    changeOutput.inputs[4] <== changeOwner;
    changeOutput.inputs[5] <== changeBlinding;
    changeOutput.out === changeCommitment;

    component emptyMaker = MerkleRoot(levels);
    component insertedMaker = MerkleRoot(levels);
    component makerIndex = IndexBits(levels);
    emptyMaker.leaf <== 0;
    insertedMaker.leaf <== makerOutputCommitment;
    for (var k = 0; k < levels; k++) {
        emptyMaker.pathElements[k] <== makerInsertionElements[k];
        emptyMaker.pathIndices[k] <== makerInsertionIndices[k];
        insertedMaker.pathElements[k] <== makerInsertionElements[k];
        insertedMaker.pathIndices[k] <== makerInsertionIndices[k];
        makerIndex.bits[k] <== makerInsertionIndices[k];
    }
    emptyMaker.root === oldRoot;
    makerIndex.index === makerOutputIndex;

    component emptyTaker = MerkleRoot(levels);
    component insertedTaker = MerkleRoot(levels);
    component takerIndex = IndexBits(levels);
    emptyTaker.leaf <== 0;
    insertedTaker.leaf <== takerOutputCommitment;
    for (var m = 0; m < levels; m++) {
        emptyTaker.pathElements[m] <== takerInsertionElements[m];
        emptyTaker.pathIndices[m] <== takerInsertionIndices[m];
        insertedTaker.pathElements[m] <== takerInsertionElements[m];
        insertedTaker.pathIndices[m] <== takerInsertionIndices[m];
        takerIndex.bits[m] <== takerInsertionIndices[m];
    }
    emptyTaker.root === insertedMaker.root;
    takerIndex.index === takerOutputIndex;

    component emptyChange = MerkleRoot(levels);
    component insertedChange = MerkleRoot(levels);
    component changeOutputIndex = IndexBits(levels);
    emptyChange.leaf <== 0;
    insertedChange.leaf <== changeCommitment;
    for (var n = 0; n < levels; n++) {
        emptyChange.pathElements[n] <== changeInsertionElements[n];
        emptyChange.pathIndices[n] <== changeInsertionIndices[n];
        insertedChange.pathElements[n] <== changeInsertionElements[n];
        insertedChange.pathIndices[n] <== changeInsertionIndices[n];
        changeOutputIndex.bits[n] <== changeInsertionIndices[n];
    }
    emptyChange.root === insertedTaker.root;
    insertedChange.root === newRoot;
    changeOutputIndex.index === changeIndex;
}

component main {public [oldRoot, newRoot, makerNullifier, takerNullifier, makerOutputCommitment, takerOutputCommitment, changeCommitment, makerOutputIndex, takerOutputIndex, changeIndex, chainId, vaultAddress, deadline]} = PrivateRfqSwap(20);
