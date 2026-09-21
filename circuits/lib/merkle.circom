pragma circom 2.1.6;

include "../../node_modules/circomlib/circuits/poseidon.circom";

template MerkleRoot(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    signal output root;

    signal hashes[levels + 1];
    signal left[levels];
    signal right[levels];
    component hashers[levels];

    hashes[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        left[i] <== hashes[i] + pathIndices[i] * (pathElements[i] - hashes[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (hashes[i] - pathElements[i]);
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        hashes[i + 1] <== hashers[i].out;
    }
    root <== hashes[levels];
}

template IndexBits(levels) {
    signal input bits[levels];
    signal output index;
    var coefficient = 1;
    var total = 0;
    for (var i = 0; i < levels; i++) {
        bits[i] * (bits[i] - 1) === 0;
        total += coefficient * bits[i];
        coefficient *= 2;
    }
    index <== total;
}
