// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.10;

import "./cobpBridge.sol";


contract COBPDeposit{

    uint THRESHOLD = 20;

    COBPBridge public bridge;
    
    function register(address bridgeAddr) external payable returns(bool){
        require(msg.value >= THRESHOLD, "should deposit more than the THRESHOLD");
        bridge = COBPBridge(bridgeAddr);
        bridge.addRelayer(msg.sender, msg.value);
        return true;
    }

    function getBalance() external view returns(uint) {
        return address(this).balance;
    }

    function transferToAddr(address payable addr, uint value) public returns (bool) {
        addr.transfer(value);
        return true;
    }
    
}
