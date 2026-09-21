pragma circom 2.1.6;

include "lib/merkle.circom";

template Deposit(levels) {
    signal input oldRoot;
    signal input newRoot;
    signal input commitment;
    signal input insertionIndex;
    signal input assetId;
    signal input amount;
    signal input chainId;
    signal input vaultAddress;
    signal input ownerPublicKey;
    signal input blinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component emptyPath = MerkleRoot(levels);
    component insertedPath = MerkleRoot(levels);
    component index = IndexBits(levels);
    component note = Poseidon(6);

    note.inputs[0] <== chainId;
    note.inputs[1] <== vaultAddress;
    note.inputs[2] <== assetId;
    note.inputs[3] <== amount;
    note.inputs[4] <== ownerPublicKey;
    note.inputs[5] <== blinding;
    note.out === commitment;

    emptyPath.leaf <== 0;
    insertedPath.leaf <== commitment;
    for (var i = 0; i < levels; i++) {
        emptyPath.pathElements[i] <== pathElements[i];
        emptyPath.pathIndices[i] <== pathIndices[i];
        insertedPath.pathElements[i] <== pathElements[i];
        insertedPath.pathIndices[i] <== pathIndices[i];
        index.bits[i] <== pathIndices[i];
    }

    emptyPath.root === oldRoot;
    insertedPath.root === newRoot;
    index.index === insertionIndex;
}

component main {public [oldRoot, newRoot, commitment, insertionIndex, assetId, amount, chainId, vaultAddress]} = Deposit(20);
