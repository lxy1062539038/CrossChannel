// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.10;
import "./cobpBridge.sol";
import "./cobpDeposit.sol";

contract COBPChannel {

    enum Chain {ETH, FABRIC} // Chain(0)=ETH, Chain(1) = FBARIC
    enum State {INIT, ACTIVATED, PRECLOSE, CLOSED}
    COBPBridge public bridge;
    COBPDeposit public deposit;
    address bridgeAddr;
    address depositAddr;
    uint TIMEOUT = 10;
    uint ARGUETIME = 100;
    uint closeTimestamp;

    struct CTX {
        bytes32 cid;
        State state; // the channel state
        uint64 txid;
        uint64 balance1;
        uint64 balance2;
        bytes signature1;
        bytes signature2;
    }

    struct BalanceProof {
        bytes32 cid;
        uint64 txid;
        uint64 balance1;
        uint64 balance2;
        bytes signature1;
        bytes signature2;
    }

    struct Channel {
        bytes32 cid; // the channel id, negotiated by the users as cid = Hash(user1, user2)
        address payable user1; // `user1` on `eth` in this sample
        string user2; // `user2` on `fabric` in this sample
        Chain chain1; // user1's blockchain, `eth` in this sample
        Chain chain2; // user2's blockchain, `fabric` in this sample
        uint64 balance1; // user1's balance
        uint64 balance2; // user2's balance
        State state;  // the channel state, `init`, `valid`, `unconfirmed`, `preclose`, `closed`
        BalanceProof balanceProof; // the balance proof, is null when initiated, be updated when closing
    }

    CTX auxiliaryCTX; // due to the limitation of variables in a function (less than 16), set the auxiliary CTX and BalanceProof
    BalanceProof auxiliaryBP;

    mapping (bytes32 => Channel) channels; // {string}cid => {Channel}channel
    mapping (bytes32 => CTX) ctxs;

    function setBridgeAddr(address newBridgeAddr) public returns (bool){
        bridgeAddr = newBridgeAddr;
        return true;
    }

    function setDepositAddr(address newDepositAddr) public returns (bool){
        depositAddr = newDepositAddr;
        return true;
    }

    /**
     * @dev participant creates a channel with cid
     *
     * @param {bytes32}cid the channel id
     * @param {address payable}user1
     * @param {string}user2
     * @param {Chain}chain1
     * @param {Chain}chain2
     * @param {uint64}balance1
     * @param {uint}balance2
     */
    function channelCreate (bytes32 cid, address payable user1, string memory user2, uint chain1, uint chain2, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) external payable returns (bool) {
        
        // Step1. create the channel in eth
        require(msg.sender == user1, "msg.sender must be same with participant");
        require(msg.value == balance1, "msg.value must be same with balance1"); // current user is user1, his balance is thus balance1
        // check whether `signature1` is the signature that this.sender signs on balanceProofHex, not finished yet, simply returns `true`
        uint64 txid = 0;
        bytes32 balanceProofHex = sha256(abi.encodePacked(cid, txid, balance1, balance2));
        require(verifyByHashAndSigBool(balanceProofHex, signature1, msg.sender), "signature1 is wrong, create failure"); // verifyByHashAndSig() now simply returns true

        // then init the balanceProof
        auxiliaryBP = BalanceProof(cid, txid, balance1, balance2, signature1, signature2); // init the balanceProof
        channels[cid] = Channel(cid, user1, user2, Chain(chain1), Chain(chain2), balance1, balance2, State.INIT, auxiliaryBP); // add to the mapping
        
        // Step2. invoke BRC.addTx to relay the channel
        bridge = COBPBridge(bridgeAddr);
        bridge.addTxToETH(cid, 0, txid, balance1, balance2, signature1, signature2); // State.INIT = 0

        // Step3. invoke BRC.getTx to get the ctx with cid from fabric, stored in auxiliaryCTX
        uint stateUint;
        (stateUint, auxiliaryCTX.txid, auxiliaryCTX.balance1, auxiliaryCTX.balance2, auxiliaryCTX.signature1, auxiliaryCTX.signature2) = bridge.getTx(cid);
        auxiliaryCTX.state = State(stateUint);
        ctxs[cid] = auxiliaryCTX;

        // Step4. check whether information matches, and ctx.state is INIT
        require(uint(auxiliaryCTX.state) == 0, "ctx from fabric do not have state INIT" );
        require(auxiliaryCTX.txid == 0, "ctx from fabric do not have txid 0");
        require(auxiliaryCTX.balance1 == balance1 && auxiliaryCTX.balance2 == balance2, "ctx from fabric do not have the same balance");

        // Step5. set channel state to `activated`
        channels[cid].state = State.ACTIVATED;
        return true;
    }


    /** 
     * @dev close the channel
     *
     * @param {bytes32}cid
     * @param {uint64}txid
     * @param {uint64}balance1
     * @param {uint64}balance2
     * @param {string}signature1
     * @param {string}signature2
     *
     * @return returns true if close channel successful or false if not
     */
    function channelClose(bytes32 cid, uint64 txid, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) public returns (bool) {
        
        // Step 1. verify signature1
        // composite the balance proof and compute hex
        bytes32 balanceProofHex = sha256(abi.encodePacked(cid, txid, balance1, balance2));
        // check whether `signature1` is the signature that this.sender signs on balanceProofHex
        require(verifyByHashAndSigBool(balanceProofHex, signature1, msg.sender), "signature1 is wrong, colse failure");
        
        // Step 2. set channel state to 'PRECLOSE', set channel bp to current value
        channels[cid].state = State.PRECLOSE;
        (auxiliaryBP.cid, auxiliaryBP.txid, auxiliaryBP.balance1, auxiliaryBP.balance2, auxiliaryBP.signature1, auxiliaryBP.signature2) = (cid, txid, balance1, balance2, signature1, signature2);

        // Step 3. set ctx and relay it by addTx()
        bridge = COBPBridge(bridgeAddr);
        bridge.addTxToETH(cid, uint(State.PRECLOSE), txid, balance1, balance2, signature1, signature2);

        closeTimestamp = block.timestamp;
        return true;
    }
    // cause Solidity doesn't support `await` or `sleep` functions, we split the channelClose() function
    // after channelClose(), the clients wait for arguetime and invokes channelClose2()
    // use a global variable `closeTimestamp` to record the timestamp when channelClose() finished, to guarantee argue time
    function channelClose2(bytes32 cid, uint64 balance1, uint64 balance2, bytes memory signature1) public returns (bool) {
        // Step 4. await for argue time
        uint nowTimestamp = block.timestamp;
        require(nowTimestamp >= closeTimestamp+ARGUETIME, "should await for argue time");

        // Step 5. get ctx from BRC and store in auxiliaryCTX, and generate new ctx and addTx() it
        uint stateUint;
        (stateUint, auxiliaryCTX.txid, auxiliaryCTX.balance1, auxiliaryCTX.balance2, auxiliaryCTX.signature1, auxiliaryCTX.signature2) = bridge.getTx(cid);
        auxiliaryCTX.state = State(stateUint);
        ctxs[cid] = auxiliaryCTX;

        // case 1: ctx.state = activated, means that bp.signature2 is invalid, therefore ignore the close require
        if(auxiliaryCTX.state == State.ACTIVATED) {
            channels[cid].state = State.ACTIVATED;
            return true;
        }
        // case 2: ctx.state = closed, means that bp is valid, and user2 has on argument, therefore settlement with current balance
        if(auxiliaryCTX.state == State.CLOSED) {
            Settlement(cid, balance1, balance2);
            return true;
        }
        // case 3: ctx.state == preclose, means that user2 has argument
        if(auxiliaryCTX.state == State.PRECLOSE) {
            bytes32 balanceProofHex = sha256(abi.encodePacked(cid, auxiliaryCTX.txid, auxiliaryCTX.balance1, auxiliaryCTX.balance2));
            if(verifyByHashAndSigBool(balanceProofHex, signature1, msg.sender)) {
                // case 3.1: if the new ctx is valid, settlement with the new balance
                Settlement(cid, auxiliaryCTX.balance1, auxiliaryCTX.balance2);
            } else {
                // case 3.2: else, settlement with the old balance
                Settlement(cid, balance1, balance2);
            }
            return true;
        }
        return true;
    }

    /** 
     * @dev argue of close, invoked by user1 when user2 requires to close the channel with old balance proof
     *
     * @param {bytes32}cid
     * @param {uint64}txid
     * @param {uint64}balance1
     * @param {uint64}balance2
     * @param {string}signature1
     * @param {string}signature2
     *
     * @return returns true if close channel successful or false if not
     */
    function colseArgueWithoutBP(bytes32 cid) public returns(bool){
        // Step1. get `ctx` and verify whether `signature1` is true, cause the argument is invoked by user on eth
        CTX memory ctx = ctxs[cid];
        require(ctx.state == State.PRECLOSE, "only preclose channel can goto argue phase");
        bytes32 balanceProofHex = sha256(abi.encodePacked(cid, ctx.txid, ctx.balance1, ctx.balance2));
        // case 1: bp.signature1 invalid
        if(verifyByHashAndSigBool(balanceProofHex, ctx.signature1, msg.sender) == false) {
            ctxs[cid].state = State.ACTIVATED; 
        }
        // case 2: bp.signature1 valid and no argue, settlement with current bp 
        else{
            Settlement(cid, ctx.balance1, ctx.balance2);
            ctxs[cid].state = State.CLOSED;        
        }
        return true;
    }

    function closeArgueWithNewBP(bytes32 cid, uint64 txid, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) public returns (bool) {
        // case 3: user1 has arguement
        return true;
    }

    /** 
     * @dev settlement when correctly close the channel with balance1 and balance2
     *
     * @param {bytes32}cid
     * @param {uint64}balance1
     * @param {uint64}balance2
     *
     * @return returns true if close channel successful or false if not
     */
    function Settlement(bytes32 cid, uint64 balance1, uint64 balance2) public returns(bool){
        return true; 
    }

    // ====================== auxiliary functions =================

    function verifyByHashAndSigBool(bytes32 hash, bytes memory signature, address sigaddress) public returns (bool) {
        return true;
    }


    function getChannel(bytes32 cid) external view returns (address user1, string memory user2, Chain chain1, Chain chain2, uint balance1, uint balance2){
        Channel memory channel = channels[cid];
        return (channel.user1, channel.user2, channel.chain1, channel.chain2, channel.balance1, channel.balance2);
    }

    /*
    function verifyByHashAndSig(bytes32 hash, bytes signature) public returns (address) {
        bytes memory signedString = signature;
        bytes32 r = bytesToBytes32(slice(signedString, 0, 32));
        bytes32 s = bytesToBytes32(slice(signedString, 32, 32));
        bytes1 v1 = slice(signedString, 64, 1)[0];
        uint8 v = uint8(v1) + 27;
        return ecrecoverDirect(hash, r, s, v);
    }

    function slice(bytes memory data, uint start, uint len) internal pure returns (bytes) {
        bytes memory b = new bytes(len);
        for(uint i=0; i<len; i++) {
            b[i] = data[i+start];
        }
        return b;
    }

    function bytesToBytes32(bytes memory source) internal pure returns (bytes32 result) {
        assembly {
            result := mload(add(source, 32))
        }
    }*/


}