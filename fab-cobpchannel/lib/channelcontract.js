'use strict';

const {Contract} = require('fabric-contract-api');
const crypto = require('crypto');

// define objectType names for prefix
const CHANNEL_PREFIX = 'channel'; // channel
const CTX_TO_ETH_PREFIX = 'ctxToETH'; // ctxToETH
const CTX_FROM_ETH_PREFIX = 'ctxFromETH'; // ctxFromETH
const PUK_PREFIX = 'puk'; // public key
const BALANCE_PREFIX = 'balance'; // balance

// define some const
const DEPOSIT_ADDR = 'depositaddr'
const TIMEOUT = 10 // try time for requiring ctxFromETH
const TIMESLEEP = 10 // wait duration for requiring ctxFromETH


class ChannelContract extends Contract {

    /**
     * invoke to create a channel
     * 
     * @param {Context} ctx 
     * @param {String} cid 
     * @param {String} user1 
     * @param {String} user2 
     * @param {String} chain1 
     * @param {String} chain2 
     * @param {Integer} balance1 
     * @param {Integer} balance2 
     * @param {Integer} arguetime
     * @param {String} signature1 
     * @param {String} signature2 
     * @returns {Object} return the created channel with JSON.stringify
     */
    async channelCreate(ctx, cid, user1, user2, chain1, chain2, balance1, balance2, arguetime, signature1, signature2) {
        console.log(`====== START : create channel ${cid} between ${user1} on ${chain1} and ${user2} on ${chain2} ======`);

        // check whether current client is user2
        let client = ctx.clientIdentity.getID();
        if(client !== user2) {
            throw new Error(`cannot create channel, cause current client ${client} isn\'t user2 ${user2}`);
        }

        // Step 1. generate a channel object, but not yet update it to the ledger

        let channel = { 
            cid: cid,
            user: [user1, user2],
            chain: [chain1, chain2],
            balance: [balance2, balance2],
            arguetime: arguetime, // in milliseconds
            state: 'INIT',
            balanceproof: {
                cid: cid,
                txid: 0,
                balance: [balance1, balance2],
                signature: [signature1, signature2]
            }
        };

        // Step 2. generat ctx=<cid, state, bp> and relay it to ETH

        let ctxToETH = {
            cid: cid,
            state: 'INIT',
            balanceproof: {
                cid: cid,
                txid: 0,
                balance: [balance1, balance2],
                signature: [signature1, signature2]
            }
        };
        let ctxToETHKey = ctx.stub.createCompositeKey(CTX_TO_ETH_PREFIX, [cid]);
        await ctx.stub.putState(ctxToETHKey, Buffer.from(JSON.stringify(ctxToETH)));

        // Step 3. get ctx from eth
        let ctxFromETHKey = ctx.stub.createCompositeKey(CTX_FROM_ETH_PREFIX, [cid]);
        let ctxFromETHBytes;
        for(let i=0; i<TIMEOUT; i+=1){
            ctxFromETHBytes = await ctx.stub.getState(ctxFromETHKey);
            if(ctxFromETHBytes!==0){
                continue;
            }
            // sleep for TIMESLEEP ms and then retry
            let counter= 0, start = new Date().getTime(), end = 0;
            while (counter < TIMESLEEP) {
                end = new Date().getTime();
                counter = end - start;
            }
        }
        if(!ctxFromETHBytes || ctxFromETHBytes === 0) {
            throw new Error(`ctx ${cid} does not exist`);
        }
        let ctxFromETH = JSON.parse(ctxFromETHBytes.toString()); // a json object

        // Step 4. check whether information matches, including state and balanceproof
        if(ctxFromETH.state !== 'Init'){
            throw new Error(`fail to create channel ${cid} due to wrong state`);
        }
        if(ctxFromETH.balanceproof !== channel.balanceproof) {
            throw new Error(`fail to create channel ${cid} due to wrong balanceproof`);
        }

        // if matches, update channel state to `activated` and update channel to the ledger
        channel.state = 'ACTIVATED';
        let channelKey = ctx.stub.createCompositeKey(CHANNEL_PREFIX, [cid]);
        await ctx.stub.putState(channelKey, Buffer.from(JSON.stringify(channel)));


        console.log(`====== END : create channel ${cid} between ${user1} on ${chain1} and ${user2} on ${chain2} ======`);
    }


    /**
     * to close a channel, invoke channelClose with a balanceproof
     * 
     * @param {Object} ctx 
     * @param {String} cid 
     * @param {Object} balanceproof used to close the channel
     * @returns current channel state
     */
    async channelClose(ctx, cid, balanceproof) {

        // Step 1. verify bp.signature2
        if(this.verifySig2InBP(ctx, balanceproof)){
            throw new Error(`close channel ${cid} failed, wrong fabric signature`);
        }
        
        // Step 2. set channel state to 'PRECLOSE'
        // Step 3. generate ctxToETH and relay it
        let ctxToETH = {
            cid: cid,
            state: 'PRECLOSE',
            balanceproof: balanceproof
        };
        let ctxToETHKey = ctx.stub.createCompositeKey(CTX_TO_ETH_PREFIX, [cid]);
        await ctx.stub.putState(ctxToETHKey, Buffer.from(JSON.stringify(ctxToETH)));

        // Step 4. await for argue time /ms
        let counter= 0, start = new Date().getTime(), end = 0;
        while (counter < channel.arguetime) {
            end = new Date().getTime();
            counter = end - start;
        }

        // Step 5. get ctxFromETH, switch 3 cases
        let ctxFromETHKey = ctx.stub.createCompositeKey(CTX_FROM_ETH_PREFIX, [cid]);
        let ctxFromETHBytes= await ctx.stub.getState(ctxFromETHKey);
        if(!ctxFromETHBytes || ctxFromETHBytes === 0) {
            throw new Error(`ctx ${cid} does not exist`);
        }
        let ctxFromETH = JSON.parse(ctxFromETHBytes.toString()); // a json object

        // handle in three cases
        switch(ctxFromETH.state) {
            case 'ACTIVATED': // case 1: ctxFromETH.state = activated
                console.log(`close channel ${cid} failed, signature on ETH wrong`);
                return 'ACTIVATED';
            case 'CLOSED': // case 2: ctxFromETH.state = closed
                this.settlement(ctx, balanceproof);
                console.log(`successfully close channel ${cid} with former balance proof`);
                return 'CLOSED';
            case 'PRECLOSE': // case 3: ctxFromETH.state = preclose
                if(this.verifySig2InBP(ctxFromETH.balanceproof)){
                    // case 3.1 newBalanceProof.signature2 valid, settle with new bp
                    balanceproof = ctxFromETH.balanceproof;
                    this.settlement(ctx, balanceproof);
                    console.log(`successfully close channel ${cid} with latter balance proof`);
                } else {
                    // case 3.2 invalid, directly settle with old bp
                    this.settlement(ctx, balanceproof);
                    console.log(`successfully close channel ${cid} with former balance proof`);
                }
                // generate a ctxToETH, cause ETH is waiting for a reply when having a `preclose` state
                ctxToETH = {
                    cid: cid,
                    state: 'CLOSED',
                    balanceproof: balanceproof
                };
                let ctxToETHKey = ctx.stub.createCompositeKey(CTX_TO_ETH_PREFIX, [cid]);
                await ctx.stub.putState(ctxToETHKey, Buffer.from(JSON.stringify(ctxToETH)));
                return 'CLOSED';
            default:
                throw new Error(`unexpected ctx.state ${ctxFromETH.state}`);
        }
    }


    /**
     * invoked by user2 when user1 requests to close the channel 
     * 
     * @param {Object} ctx 
     * @param {String} cid 
     * @param {Object} newBalanceproof 
     * @returns the ctxToETH
     */
    async closeArgue(ctx, cid, newBalanceproof) {
        
        // get channel and ctxFromETH 
        let channelKey = ctx.stub.createCompositeKey(CHANNEL_PREFIX, [cid]);
        let channelBytes = await ctx.stub.getState(channelKey);
        if(!channelBytes || channelBytes.length === 0) {
            throw new Error(`sellte failed on channel ${cid}, channel dose not exist`);
        }
        let channel = JSON.parse(channelBytes.toString());

        let ctxFromETHKey = ctx.stub.createCompositeKey(CTX_FROM_ETH_PREFIX, [cid]);
        let ctxFromETHBytes= await ctx.stub.getState(ctxFromETHKey);
        if(!ctxFromETHBytes || ctxFromETHBytes === 0) {
            throw new Error(`ctx ${cid} does not exist`);
        }
        let ctxFromETH = JSON.parse(ctxFromETHBytes.toString()); // a json object

        let ctxToETH;
        // case 1: bp.signature2 invalid
        if(this.verifySig2InBP(ctxFromETH.balanceproof) === false) {
            ctxToETH = {
                cid: cid,
                state: 'ACTIVATED',
                balanceproof: channel.balanceproof
            };
        }

        // case 2: ctxFromETH.balanceProof === newBalanceproof || ctxFromETH.bp.signature2 invalid
        else{
            if(this.verifySig2InBP(newBalanceproof) === false) {
                this.settlement(ctx, channel.balanceproof);
                ctxToETH = {
                    cid: cid,
                    state: 'CLOSED',
                    balanceproof: channel.balanceproof
                };
            } else {
        // case 3: ctxFromETH.balanceProof.signature2 valid
                ctxToETH = {
                    cid: cid,
                    state: 'PRECLOSE',
                    balanceproof: newBalanceproof
                };
            }
        }

        // relay ctxToETH
        let ctxToETHKey = ctx.stub.createCompositeKey(CTX_TO_ETH_PREFIX, [cid]);
        await ctx.stub.putState(ctxToETHKey, Buffer.from(JSON.stringify(ctxToETH)));
        
        return ctxToETH;
    }



    // ======================== some auxiliary functions =========================

    /**
     * mint some token, as a sample for htlc, minting is unlimited
     * 
     * @param {Context} ctx The transaction context
     * @param {Integer} amount Amount of tokens to be minted
     * @returns {Boolean} Return whether the Mint was successful or not
     */
     async mint(ctx, amount) {

        let minter = ctx.clientIdentity.getID();

        console.log(`======= START : Mint ${amount} token to ${minter} ======`);

        let amountInt = parseInt(amount);
        if(amountInt<0) {
            throw new Error('mint amount must be a positive integer');
        } 

        // increase the balance
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [minter]);
        let currentBalanceBytes = await ctx.stub.getState(balanceKey);
        let currentBalance;
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            currentBalance = 0;
        } else {
            currentBalance = parseInt(currentBalanceBytes.toString());
        }
        let updatedBalance = currentBalance + amountInt;

        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        // Emit the Transfer event
        // let transferEvent = { from: '0x0', to: minter, value: amountInt};
        // ctx.stub.setEvent('Transfer', Buffer.from(JSON.stringify(transferEvent)));

        console.log(`====== END mint, ${minter} balance updated from ${currentBalance} to ${updatedBalance} ======`);

        return true;
    }


    /**
     * verify whether `signature` is signed by `user` on `msg`
     * 
     * @param {Object} ctx 
     * @param {String} msg
     * @param {String} signature 
     * @param {String} user 
     * @returns `true` if `signature` is signed by `user`, or `false` else
     */
    async verifySig(ctx, msg, signature, user) {
        
        // if valid, return true; else, return false
        // simply return true in current version
        return true;
    }

    /**
     * verify whether signature2 in a `balanceproof` is signed by current client
     * 
     * @param {Object} ctx 
     * @param {Object} balanceproof 
     * @returns `true` if `signature2` in `balanceproof` is signed by current client, or `false` else
     */
    async verifySig2InBP(ctx, balanceproof) {
        let result = false;
        let msg = JSON.stringify(balanceproof);
        let user2 = ctx.clientIdentity.getID();
        let user2pukKey = ctx.stub.createCompositeKey(PUK_PREFIX, [user2]);
        let user2puk = await ctx.stub.getState(user2pukKey);
        return this.verifySig(ctx, msg, balance.signature[1], user2puk);
    }


    /**
     * update `user`'s public key
     * 
     * @param {Object} ctx 
     * @param {String} user
     * @param {String} puk 
     */
    async setPuk(ctx, user, puk){
        let pukKey = ctx.stub.createCompositeKey(PUK_PREFIX, [user]);
        await ctx.stub.putState(pukKey, Buffer.from(puk));
        return true;
    }


    /**
     * invoked when closing a channel, to update channel and transfer token
     * 
     * @param {Object} ctx 
     * @param {Object} balanceproof 
     */
    async settlement(ctx, balanceproof) {
        // update channel
        let channelKey = ctx.stub.createCompositeKey(CHANNEL_PREFIX, [cid]);
        let channelBytes = await ctx.stub.getState(channelKey);
        if(!channelBytes || channelBytes.length === 0) {
            throw new Error(`sellte failed on channel ${cid}, channel dose not exist`);
        }
        let channel = JSON.parse(channelBytes.toString());
        let transferBalance = channel.balance[1]-balanceproof.balance[1];
        channel.state = 'CLOSED';
        channel.balanceproof = balanceproof;
        await ctx.stub.putState(channelKey, Buffer.from(channel.toString()));

        // transfer token
        // 1) update user2's balance
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [channel.user[1]]);
        let currentBalanceBytes = await ctx.stub.getState(balanceKey);
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            throw new Error(`settlememt failed, fabric user ${channel.user[1]} does not exist`);
        }
        let currentBalance = parseInt(currentBalanceBytes.toString());
        let updatedBalance = currentBalance + balanceproof.balance[1];
        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        // 2) update deposit
        balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [DEPOSIT_ADDR]);
        currentBalanceBytes = await ctx.stub.getState(balanceKey);
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            throw new Error('settlememt failed, fabric deposit address does not exist');
        }
        currentBalance = parseInt(currentBalanceBytes.toString());
        updatedBalance = currentBalance + transferBalance;
        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        return true;
    }

}

module.exports = ChannelContract;