// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.10;


contract COBPBridge{

    enum Chain {ETH, FABRIC} // Chain(0)=ETH, Chain(1) = FBARIC
    enum State {INIT, VALID, UNCONFIRMED, PRECLOSE, CLOSED}

    struct CTX {
        bytes32 cid;
        State state; // the channel state
        uint64 txid;
        uint64 balance1;
        uint64 balance2;
        bytes signature1;
        bytes signature2;
    }

    mapping(bytes32 => CTX) public ctxFromFabrics; // cause we only need the latest ctx, we update it
    mapping(bytes32 => CTX) public ctxToFabrics; // cause we only need the latest ctx, we update it

    CTX[] public relayRecord; // the relay record to be consensus on for each time slot

    


    // ============================= relayer management ===============================

    struct Relayer {
        address relayerAddr;
        uint relayerDeposit;
        uint relayerReputation;
        uint relayerStake;
    }

    Relayer[] public relayerList; // the valid relayers, need 2/3 consensus


    /**
     * @dev add a relay to the relayerList, should have access control, but ignored in this sample
     * in scheme design, when a ETH user locks enough money to the deposit contract, the contract then 
     * automatically invokes this function to add it into the list, this function is supposed to be 
     * invoked only by this way, and should not be invoked by other users, this access control is ignored in this sample

     * @param {address} relayer
     * @return true if add relayer successfully
     */
    function addRelayer(address relayerAddr, uint relayerDeposit) external returns(uint){
        Relayer memory relayer = Relayer(relayerAddr, relayerDeposit, relayerDeposit, relayerDeposit);
        relayerList.push(relayer);
        return relayerList.length;
    }

    function getRelayers() external view returns(Relayer[] memory) {
        return relayerList;
    }


    // ========================= Consensus on the relay ctx ========================
    
    // step1. the relayer first get the current record
    function getRecord() external view returns (CTX[] memory) {
        return relayRecord;
    }
    // step2. the relayer then verify each ctx in the record

    // step3. after that, the relayer invoke recordConsensus() to upload his verification result and signature
    // for simplicity, regard all valid
    function recordConsensus() external returns(bool){
        for(uint i=0; i<relayRecord.length; i++){
            CTX memory ctx = relayRecord[i];
            ctxFromFabrics[ctx.cid] = ctx;
        }
        return true;
    }



    // =========================== Add ctx to the relay record ===========================

    /**
     * @dev add a ctx=(cid, state, bp) to the COBPBridge contract, invoked by ETH relayers with Fabric
     * should first add it to the current record list and wait for consensus
     * solidity does not support async, thus addTx only add a ctx to the relayRecord
     * and will not tell the consensus result
     */
    function addTxFromFabric(bytes32 cid, uint state, uint64 txid, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) external returns (bool) {
        CTX memory ctx = CTX(cid, State(state), txid, balance1, balance2, signature1, signature2);
        // add the input ctx to the current record list, but do not modify the ctx mapping
        relayRecord.push(ctx);
        return true;
    }

    function addTxFromFabricNoConsensus(bytes32 cid, uint state, uint64 txid, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) external returns (bool) {
        CTX memory ctx = CTX(cid, State(state), txid, balance1, balance2, signature1, signature2);
        // add the input ctx to the current record list, but do not modify the ctx mapping
        ctxFromFabrics[cid] = ctx;
        return true;
    }


    // addTxToFabric is invoked by ETH users that have channel with fabric
    // note the different between `addTxToETH` and `addTxToFabric`
    function addTxToFabric(bytes32 cid, uint state, uint64 txid, uint64 balance1, uint64 balance2, bytes memory signature1, bytes memory signature2) public returns (bool){
        CTX memory ctx = CTX(cid, State(state), txid, balance1, balance2, signature1, signature2);
        // add the input ctx to the current record list, but do not modify the ctx mapping
        ctxToFabrics[cid] = ctx;
        return true;
    }

    // if other blockchain is included, use `function addTxToOtherBlockchain()`


    // ========================== get ctx by cid =============================

    /**
    * @dev get a ctx=(cid, state, bp) with cid from COBPBridge contract
    *
    * @param {bytes32}cid
    * @return return the ctx=(cid, state, bp)
    */
    function getTx(bytes32 cid) public view returns (uint, uint64, uint64, uint64, bytes memory, bytes memory) {
        CTX memory ctx = ctxFromFabrics[cid];
        return (uint(ctx.state), ctx.txid, ctx.balance1, ctx.balance2, ctx.signature1, ctx.signature2);
    }
}