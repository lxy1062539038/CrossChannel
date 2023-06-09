'use strict';

const {Contract} = require('fabric-contract-api');
const crypto = require('crypto');

// define objectType names for prefix
const CTX_TO_ETH_PREFIX = 'ctxToETH'; 
const CTX_FROM_ETH_PREFIX = 'ctxFromETH'; 
const RELAYER_PREFIX = 'relayer';
const RECORD_FROM_ETH_PREFIX = 'recordFromETH';

/*
    a record object is as:
    record = {
        record: ctxFromETH[], // the set of ctxFromETH
        approval: aggSignature // the aggregation of 2/3 signatures
    }
*/

class BridgeContract extends Contract {

    /**
     * invoked by relayers to upload a set of ctxFromETH, i.e., a record
     * 
     * @param {Object} ctx 
     * @param {Object} recordFromETH 
     * @param {String} cid 
     */
     async uploadRecordFromETH(ctx, recordFromETH) {

        // add recordFromETH into recordFromETH Object

        return true;
    }

    /**
     * invoked by relayers to consensus a newly uploaded record
     * 
     * @param {Object} ctx 
     * @param {Object} recordFromETH 
     * @param {String} cid 
     */
    async consensusRecordFromETH(ctx, recordFromETH, aggSignature) {

        // verify whether the aggSignature is an aggregation of more than 2/3 relayers' signature on `recordFromETH`

        // if yes, return true; else, return false
        // simply return true at the current version
        return true;

    }


    /**
     * used for test, simply add a ctxFromETH, without consensus and record
     * 
     * @param {Object} ctx 
     * @param {Object} ctxFromETH 
     */
    async simplyAddCtxFromETH(ctx, ctxFromETH) {
        let ctxFromETHKey = ctx.stub.createCompositeKey(CTX_FROM_ETH_PREFIX, [ctxFromETH.cid]);
        await ctx.stub.putState(ctxFromETHKey, Buffer.from(JSON.stringify(ctxFromETH)));
        return true;
    }


}



module.exports = BridgeContract;