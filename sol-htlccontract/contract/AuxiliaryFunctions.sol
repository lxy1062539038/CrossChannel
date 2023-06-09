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
}