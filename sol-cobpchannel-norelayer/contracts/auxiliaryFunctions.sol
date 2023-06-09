// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.10;

contract AuxiliaryFunctions {

    function genSecretHash (string memory preimage) public pure returns (bytes32 secretHash) {
        secretHash = sha256(abi.encodePacked(preimage));
        return secretHash;
    }

    function getTimestamp () public view returns (uint256 currentTime) {
        currentTime = block.timestamp;
        return currentTime;
    }

    function toBytes(address a) public pure returns (bytes memory) {
        bytes memory bytesa = abi.encodePacked(a);
        return bytesa;
    }

    function getCid (bytes memory participant, string memory partner) public pure returns (bytes32 cid) {
        cid = sha256(abi.encodePacked(participant, partner));
        return cid;
    }

    function compositeBalanceProof(bytes32 cid, uint64 txid, uint64 balance1, uint64 balance2) public pure returns (bytes memory balanceProof){
        balanceProof = abi.encodePacked(cid, txid, balance1, balance2);
        return balanceProof;
    }

    function compositeBalanceProofAndHash(bytes32 cid, uint64 txid, uint64 balance1, uint64 balance2) public pure returns (bytes32 balanceProofHex){
        bytes memory balanceProof = abi.encodePacked(cid, txid, balance1, balance2);
        balanceProofHex = sha256(balanceProof);
        return balanceProofHex;
    }

    function uintToBytes(uint uintData) public pure returns (bytes memory bytesData) {
        bytesData = abi.encodePacked(uintData);
        return bytesData;
    }

    function uint64ToBytes(uint64 uintData) public pure returns (bytes memory bytesData) {
        bytesData = abi.encodePacked(uintData);
        return bytesData;
    }

    function uint32ToBytes(uint32 uintData) public pure returns (bytes memory bytesData) {
        bytesData = abi.encodePacked(uintData);
        return bytesData;
    }

    
    // ===================================  verify signature ===============================
    
    function decodeSignature(bytes32 sigMsg, bytes memory signedString) public pure returns (address) {
        bytes32 r = bytesToBytes32(slice(signedString, 0, 32));
        bytes32 s = bytesToBytes32(slice(signedString, 32, 64));
        uint8 v =uint8(slice(signedString, 64, 1)[0]);

        return ecrecover(sigMsg, v, r,s);
    }

    // slice, used to slice the signature to (r, s, v)
    function slice(bytes memory data, uint start, uint len) public pure returns (bytes memory sdata) {
        sdata = new bytes(len);
        for(uint i=0; i<len; i++) {
            sdata[i] = data[i+start];
        }
        return sdata;
    }

    function bytesToBytes32(bytes memory source) public pure returns (bytes32 result) {
        assembly {
            result := mload(add(source, 32))
        }
    }
}