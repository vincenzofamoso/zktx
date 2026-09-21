pragma circom 2.1.6;

include "lib/merkle.circom";

template Transfer(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input nullifier;
    signal input outputCommitmentOne;
    signal input outputCommitmentTwo;
    signal input insertionIndexOne;
    signal input insertionIndexTwo;
    signal input chainId;
    signal input vaultAddress;

    signal input ownerSecret;
    signal input assetId;
    signal input inputAmount;
    signal input inputBlinding;
    signal input inputPathElements[levels];
    signal input inputPathIndices[levels];
    signal input outputOwnerOne;
    signal input outputAmountOne;
    signal input outputBlindingOne;
    signal input outputOwnerTwo;
    signal input outputAmountTwo;
    signal input outputBlindingTwo;
    signal input insertionPathOneElements[levels];
    signal input insertionPathOneIndices[levels];
    signal input insertionPathTwoElements[levels];
    signal input insertionPathTwoIndices[levels];

    component owner = Poseidon(1);
    owner.inputs[0] <== ownerSecret;

    component inputNote = Poseidon(6);
    inputNote.inputs[0] <== chainId;
    inputNote.inputs[1] <== vaultAddress;
    inputNote.inputs[2] <== assetId;
    inputNote.inputs[3] <== inputAmount;
    inputNote.inputs[4] <== owner.out;
    inputNote.inputs[5] <== inputBlinding;

    component spend = Poseidon(4);
    spend.inputs[0] <== inputNote.out;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== chainId;
    spend.inputs[3] <== vaultAddress;
    spend.out === nullifier;

    component member = MerkleRoot(levels);
    member.leaf <== inputNote.out;
    for (var i = 0; i < levels; i++) {
        member.pathElements[i] <== inputPathElements[i];
        member.pathIndices[i] <== inputPathIndices[i];
    }
    member.root === oldRoot;

    component outputOne = Poseidon(6);
    outputOne.inputs[0] <== chainId;
    outputOne.inputs[1] <== vaultAddress;
    outputOne.inputs[2] <== assetId;
    outputOne.inputs[3] <== outputAmountOne;
    outputOne.inputs[4] <== outputOwnerOne;
    outputOne.inputs[5] <== outputBlindingOne;
    outputOne.out === outputCommitmentOne;

    component outputTwo = Poseidon(6);
    outputTwo.inputs[0] <== chainId;
    outputTwo.inputs[1] <== vaultAddress;
    outputTwo.inputs[2] <== assetId;
    outputTwo.inputs[3] <== outputAmountTwo;
    outputTwo.inputs[4] <== outputOwnerTwo;
    outputTwo.inputs[5] <== outputBlindingTwo;
    outputTwo.out === outputCommitmentTwo;
    inputAmount === outputAmountOne + outputAmountTwo;

    component emptyOne = MerkleRoot(levels);
    component insertedOne = MerkleRoot(levels);
    component indexOne = IndexBits(levels);
    emptyOne.leaf <== 0;
    insertedOne.leaf <== outputCommitmentOne;
    for (var j = 0; j < levels; j++) {
        emptyOne.pathElements[j] <== insertionPathOneElements[j];
        emptyOne.pathIndices[j] <== insertionPathOneIndices[j];
        insertedOne.pathElements[j] <== insertionPathOneElements[j];
        insertedOne.pathIndices[j] <== insertionPathOneIndices[j];
        indexOne.bits[j] <== insertionPathOneIndices[j];
    }
    emptyOne.root === oldRoot;
    indexOne.index === insertionIndexOne;

    component emptyTwo = MerkleRoot(levels);
    component insertedTwo = MerkleRoot(levels);
    component indexTwo = IndexBits(levels);
    emptyTwo.leaf <== 0;
    insertedTwo.leaf <== outputCommitmentTwo;
    for (var k = 0; k < levels; k++) {
        emptyTwo.pathElements[k] <== insertionPathTwoElements[k];
        emptyTwo.pathIndices[k] <== insertionPathTwoIndices[k];
        insertedTwo.pathElements[k] <== insertionPathTwoElements[k];
        insertedTwo.pathIndices[k] <== insertionPathTwoIndices[k];
        indexTwo.bits[k] <== insertionPathTwoIndices[k];
    }
    emptyTwo.root === insertedOne.root;
    insertedTwo.root === newRoot;
    indexTwo.index === insertionIndexTwo;
}

component main {public [oldRoot, newRoot, nullifier, outputCommitmentOne, outputCommitmentTwo, insertionIndexOne, insertionIndexTwo, chainId, vaultAddress]} = Transfer(20);
