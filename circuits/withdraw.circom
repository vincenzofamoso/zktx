pragma circom 2.1.6;

include "lib/merkle.circom";

template Withdraw(levels) {
    signal input root;
    signal input nullifier;
    signal input assetId;
    signal input recipient;
    signal input amount;
    signal input chainId;
    signal input vaultAddress;
    signal input ownerSecret;
    signal input blinding;
    signal input pathElements[levels];
    signal input pathIndices[levels];

    component owner = Poseidon(1);
    owner.inputs[0] <== ownerSecret;

    component note = Poseidon(6);
    note.inputs[0] <== chainId;
    note.inputs[1] <== vaultAddress;
    note.inputs[2] <== assetId;
    note.inputs[3] <== amount;
    note.inputs[4] <== owner.out;
    note.inputs[5] <== blinding;

    component member = MerkleRoot(levels);
    member.leaf <== note.out;
    for (var i = 0; i < levels; i++) {
        member.pathElements[i] <== pathElements[i];
        member.pathIndices[i] <== pathIndices[i];
    }
    member.root === root;

    component spend = Poseidon(4);
    spend.inputs[0] <== note.out;
    spend.inputs[1] <== ownerSecret;
    spend.inputs[2] <== chainId;
    spend.inputs[3] <== vaultAddress;
    spend.out === nullifier;
    signal recipientBinding;
    recipientBinding <== recipient * recipient;
}

component main {public [root, nullifier, assetId, recipient, amount, chainId, vaultAddress]} = Withdraw(20);
