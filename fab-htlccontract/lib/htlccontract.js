'use strict';

const {Contract}  = require('fabric-contract-api');
const crypto = require('crypto');

// Define objectType names for prefix
const BALANCE_PREFIX = 'balance'; // balanceKey: 'balance'+account
const HTLC_PREFIX = 'htlc'; // htlcKey: 'htlc'+sender+recipient



class HTLCContract extends Contract {

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
     * issue htlc
     * 
     * @param {Context} ctx the transaction context
     * @param {String} secretHash
     * @param {String} sender
     * @param {String} recipient
     * @param {integer} value
     * @param {integer} endtime
     * @returns {Object} return the issued htlc with JSON.stringify
     */
    async issue(ctx, secretHash, sender, recipient, value, endtime) {
        console.log(`======= START : Issue htlc ${sender}:${recipient} ======`);

        // check whether current client is sender, cause only sender can lock token
        let client = ctx.clientIdentity.getID();
        if(client !== sender) {
            throw new Error(`cannot issue htlc ${sender}:${recipient}, current client ${client} isn\'t sender ${sender}`);
        }

        // check whether `sender` balance is enough and lock `value` token
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [sender]);
        let currentBalanceBytes = ctx.stub.getState(balanceKey);
        let valueInt = parseInt(value);
        if( !currentBalanceBytes || currentBalanceBytes.length === 0 ){
            throw new Error(`cannot issue htlc ${sender}:${recipient}, the sender ${sender} account does not exist`);
        } 
        let currentBalance = parseInt(currentBalanceBytes.toString());
        
        if(currentBalance < value){
            throw new Error(`cannot issue htlc ${sender}:${recipient}, the sender ${sender}\'s balance ${currentBalance} is less than htlc value ${valueInt}`);
        }

        let updatedBalance = currentBalance - valueInt;
        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        console.log(`during issue htlc ${sender}:${recipient}, lock ${value} token of sender ${sender}, balance from ${currentBalance} to ${updatedBalance}`);

        // generate a htlc object and update it to the ledger
        let htlc = {secretHash: secretHash, sender: sender, recipient: recipient, value: value, endtime: endtime, preimage: null, state: 'ISSUED', version: 0};

        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);

        await ctx.stub.putState(htlcKey, Buffer.from(JSON.stringify(htlc)));

        console.log(`======= END : Issue htlc ${sender}:${recipient} ======`);

        return JSON.stringify(htlc);
    }

    /**
     * withdraw htlc
     * 
     * @param {Context} ctx the transaction context
     * @param {String} sender
     * @param {String} recipient
     * @param {String} preimage
     * @returns {Boolean} returns whether the withdraw is successful or not
     */
    async withdraw(ctx, sender, recipient, preimage) {
        
        console.log(`====== START withdraw htlc ${sender}:${recipient} ======`);

        // check whether the htlc exists and require it from the ledger
        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);
        let htlcBytes = await ctx.stub.getState(htlcKey);
        if(!htlcBytes || htlcBytes.length === 0) {
            throw new Error(`htlc ${sender}:${recipient} does not exist`);
        }
        let htlc = JSON.parse(htlcBytes.toString());

        // check whether the client is recipient, cause only recipient can withdraw htlc
        let client = ctx.clientIdentity.getID();
        if(client !== htlc.recipient) {
            throw new Error(`cannot withdraw htlc ${sender}:${recipient}, current client ${client} isn\'t recipient ${htlc.recipient}`);
        }

        // check whether the htlc state is ISSUED
        if(htlc.state !== 'ISSUED') {
            throw new Error(`cannot withdraw htlc ${sender}:${recipient}, state is not ISSUED`);
        }
        
        // check the preimage
        let sha256 = crypto.createHash('sha256');
        let newSecretHash = sha256.update(preimage).digest('hex'); // the new hash
        if(newSecretHash !== htlc.secretHash){
            throw new Error(`cannot withdraw htlc ${sender}:${recipient}, wrong preimage ${preimage} with wrong hash ${newSecretHash}, secretHash is ${htlc.secretHash}`);
        }

        // unlock token and transfer it to recipient
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [recipient]);
        let currentBalanceBytes = await ctx.stub.getState(balanceKey);
        let currentBalance;
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            currentBalance = 0;
        } else {
            currentBalance = parseInt(currentBalanceBytes.toString());
        }
        let value = htlc.value;
        let updatedBalance = currentBalance + parseInt(value);

        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        console.log(`during withdraw htlc ${sender}:${recipient}, unlock ${value} token and transfer to recipient ${recipient}, balance from ${currentBalance} to ${updatedBalance}`);

        // update htlc state and preimage
        htlc.state = 'WITHDRAWN';
        htlc.preimage = preimage;
        await ctx.stub.putState(htlcKey, Buffer.from(htlc.toString()));

        console.log(`====== END withdraw htlc ${sender}:${recipient} ======`);
    }

    /**
     * redeem htlc
     * 
     * @param {Context} ctx the transaction context
     * @param {String} sender
     * @param {String} recipient
     */
    async redeem(ctx, sender, recipient) {

        console.log(`====== START redeem htlc ${sender}:${recipient} ======`);

        // check whether the htlc exists and require it from the ledger
        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);
        let htlcBytes = await ctx.stub.getState(htlcKey);
        if(!htlcBytes || htlcBytes.length === 0) {
            throw new Error(`htlc ${sender}:${recipient} does not exist`);
        }
        let htlc = JSON.parse(htlcBytes.toString());
        
        console.log(`required htlc`)

        // check whether the client is sender, cause only sender can redeem htlc
        let client = ctx.clientIdentity.getID();
        if(client !== htlc.sender) {
            throw new Error(`cannot redeem htlc ${sender}:${recipient}, current client ${client} isn\'t sender ${htlc.sender}`);
        }
        
        // check whether htlc is ISSUED, cause only issued htlc can be redeemed
        if(htlc.state !== 'ISSUED') {
            throw new Error(`cannot redeem htlc ${sender}:${recipient}, state is not ISSUED`);
        }

        // check whether current time is large than endtime
        let currentTime = new Date().getTime();
        if(currentTime < htlc.endtime) {
            throw new Error(`cannot redeem htlc ${sender}:${recipient}, endtime not reached`);
        }
        
        // unlock token and transfer it to sender
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [sender]);
        let currentBalanceBytes = await ctx.stub.getState(balanceKey);
        let currentBalance;
        if (!currentBalanceBytes || currentBalanceBytes.length === 0) {
            currentBalance = 0;
        } else {
            currentBalance = parseInt(currentBalanceBytes.toString());
        }

        let value = htlc.value;
        let updatedBalance = currentBalance + parseInt(value);

        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        console.log(`during redeem htlc ${sender}:${recipient}, unlock ${value} token and transfer to sender ${sender}, balance from ${currentBalance} to ${updatedBalance}`);

        // update htlc state
        htlc.state = 'REDEEMED';
        await ctx.stub.putState(htlcKey, Buffer.from(htlc.toString()));

        console.log(`====== END redeem htlc ${sender}:${recipient} ======`);

    }

    /**
     * refund htlc, the sender locks token again and state becomes ISSUED
     * 
     * @param {Context} ctx the transaction context
     * @param {String} secretHash
     * @param {String} sender
     * @param {String} recipient
     * @param {integer} value
     * @param {integer} endtime
     * @returns {Object} return the htlc with JSON.stringify
     */
    async refund(ctx, secretHash, sender, recipient, value, endtime) {
        console.log(`======= START : Refund htlc ${sender}:${recipient} ======`);

        // check whether htlc exists and require it from ledger
        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);
        let htlcBytes = await ctx.stub.getState(htlcKey);
        if(!htlcBytes || htlcBytes.length === 0) {
            throw new Error(`htlc ${sender}:${recipient} does not exist`);
        }
        let htlc = JSON.parse(htlcBytes.toString());
        
        sender = htlc.sender; // update sender and recipient
        recipient = htlc.recipient; // to prevent request with different account

        // check whether current client is `sender`, cause only `sender` can lock token
        let client = ctx.clientIdentity.getID();
        if(client !== sender) {
            throw new Error(`cannot issue htlc ${sender}:${recipient}, current client ${client} isn\'t sender ${sender}`);
        }

        // check whether `sender` balance is enough and lock `value` token
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [sender]);
        let currentBalanceBytes = ctx.stub.getState(balanceKey);
        let valueInt = parseInt(value);
        if( !currentBalanceBytes || currentBalanceBytes.length === 0 ){
            throw new Error(`cannot refund htlc ${sender}:${recipient}, the sender ${sender} account does not exist`);
        } 
        let currentBalance = parseInt(currentBalanceBytes.toString());
        
        if(currentBalance < value){
            throw new Error(`cannot refund htlc ${sender}:${recipient}, the sender ${sender}\'s balance ${currentBalance} is less than htlc value ${valueInt}`);
        }

        let updatedBalance = currentBalance - valueInt;
        await ctx.stub.putState(balanceKey, Buffer.from(updatedBalance.toString()));

        console.log(`during issue htlc ${sender}:${recipient}, lock ${value} token of sender ${sender}, balance from ${currentBalance} to ${updatedBalance}`);

        // update htlc and update it to the ledger
        htlc.secretHash = secretHash;
        htlc.value = value;
        htlc.endtime = endtime;
        htlc.preimage = null;
        htlc.state = 'ISSUED';
        htlc.version = htlc.version + 1;

        await ctx.stub.putState(htlcKey, Buffer.from(JSON.stringify(htlc)));

        console.log(`======= END : Refund htlc ${sender}:${recipient} ======`);

        return JSON.stringify(htlc);
    }


    // ================== Extended Functions ==========================
    
    // get current client ID
    async clientAccountID(ctx) {
        let client = ctx.clientIdentity.getID();
        return client;
    }

    // get current client balance
    async clientBalance(ctx) {
        let client = ctx.clientIdentity.getID();
        let balanceKey = ctx.stub.createCompositeKey(BALANCE_PREFIX, [client]);
        let balanceBytes = await ctx.stub.getState(balanceKey);
        if(!balanceBytes || balanceBytes.length===0) {
             throw new Error(`the client ${client} balance dose not exist`);
        }
        let balance = parseInt(balanceBytes.toString());
        return balance;
    }

    // check whether a htlc exists between sender and recipient
    async htlcExist(ctx, sender, recipient) {
        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);
        let htlcBytes = await ctx.stub.getState(htlcKey);
        if(!htlcBytes || htlcBytes.length === 0) {
            return false;
        }
        return true;
    }

    // require a existed htlc from ledger
    async htlcRequire(ctx, sender, recipient) {
        let htlcKey = ctx.stub.createCompositeKey(HTLC_PREFIX, [sender, recipient]);
        let htlcBytes = await ctx.stub.getState(htlcKey);
        if(!htlcBytes || htlcBytes.length === 0) {
            throw new Error(`htlc ${sender}:${recipient} does not exist`);
        }
        let htlc = JSON.parse(htlcBytes.toString());
        return htlc;
    }
    

}

module.exports = HTLCContract;