'use strict';

const {Contract} = require('fabric-contract-api');
const crypto = require('crypto');

// define objectType names for prefix
const RELAYER_PREFIX = 'relayer'; // state is `stake`, currently use the depositValue
const BALANCE_PREFIX = 'balance'; // balanceKey: 'balance'+account

// define some consts
const DEPOSIT_ADDR = 'depositaddr';
const DEPOSIT_VALUE = 10; 

class DepositContract extends Contract {

    /**
     * current client register to be a relayer
     * 
     * @param {Object} ctx 
     * @param {Integer} depositValue 
     * @returns 
     */
    async register(ctx, depositValue) {
        if(depositValue < DEPOSIT_VALUE) {
            throw new Error(`register failed, depositValue ${depositValue} is less than required value ${DEPOSIT_VALUE}`);
        }

        // Step 1. update current client's balance
        let client = ctx.clientIdentity.getID();
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [client]);
        let currentBalanceBytes = await ctx.stub.getState(balanceKey);
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            currentBalance = 0;
        } else {
            currentBalance = parseInt(currentBalanceBytes.toString());
        }
        if(currentBalance < depositValue) {
            throw new Error(`register failed, account balance ${currentBalance} is less than depositValue ${depositValue}`);
        }
        let updatedBalance = currentBalance - depositValue;
        await ctx.stub.putState(BALANCE_PREFIX, Buffer.from(updatedBalance.toString()));
        
        // Step 2. update deposit address's balance
        balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [DEPOSIT_ADDR]);
        currentBalanceBytes = await ctx.stub.getState(balanceKey);
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            currentBalance = 0;
        } else {
            currentBalance = parseInt(currentBalanceBytes.toString());
        }
        updatedBalance = currentBalance + depositValue;
        await ctx.stub.putState(BALANCE_PREFIX, Buffer.from(updatedBalance.toString()));

        // Step 3. update relayer state
        let relayerKey = ctx.stub.createCompositeKey(RELAYER_PREFIX, [client]);
        await ctx.stub.putState(relayerKey, Buffer.from(depositValue.toString()));

        return true;
    }
}

module.exports = DepositContract;