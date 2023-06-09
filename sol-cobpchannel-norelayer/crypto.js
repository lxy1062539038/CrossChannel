'use strict'

const crypto = require('crypto');
const { mainModule } = require('process');


// create sha256 hash and get cid
function generateCid(user1, user2, chain1, chain2) {
    let hash = crypto.createHash('sha256');
    let cid = hash.update(user1 + user2 + chain1 + chain2).digest('hex');
    return cid;
}

function invokeGenerateCid() {
    let user1 = '0x5B38Da6a701c568545dCfcB03FcB875f56beddC4';
    let user2 = 'fabricaddress';
    let chain1 = 'eth';
    let chain2 = 'fabric';
    let cid = generateCid(user1, user2, chain1, chain2);
    console.log(`compute cid: ${cid}`);
    return true;
}

invokeGenerateCid();

