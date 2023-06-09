// SPDX-License-Identifier: AGPL-3.0

pragma solidity ^0.8.10;


/**
 * @title Hash Time Lock Contract (HTLC)
 *
 * @author Meheret Tesfaye Batu <meherett@zoho.com>
 *
 * HTLC -> A Hash Time Lock Contract is essentially a type of payment in which two people
 * agree to a financial arrangement where one party will pay the other party a certain amount
 * of cryptocurrencies, such as Bitcoin or Ethereum assets.
 * However, because these contracts are Time-Locked, the receiving party only has a certain
 * amount of time to accept the payment, otherwise the money can be returned to the sender.
 *
 * Hash-Locked -> A Hash locked functions like “two-factor authentication” (2FA). It requires
 * the intended recipient to provide the correct secret passphrase to withdraw the funds.
 *
 * Time-Locked -> A Time locked adds a “timeout” expiration date to a payment. It requires
 * the intended recipient to claim the funds prior to the expiry. Otherwise, the transaction
 * defaults to enabling the original sender of funds to withdraw a refund.
 */


contract HTLC {


    struct LockedContract {
        bytes32 secretHash;
        address payable recipient;
        address payable sender;
        uint endtime;
        uint amount;
        bool withdrawn;
        bool refunded;
        string preimage;
    }

    mapping (bytes32 => LockedContract) lockedContracts;

    event LogFund (
        bytes32 indexed lockedContractID,
        bytes32 secretHash,
        address indexed recipient,
        address indexed sender,
        uint endtime,
        uint amount
    );

    event LogWithdraw (
        bytes32 indexed lockedContractID
    );

    event LogRefund (
        bytes32 indexed lockedContractID
    );

    modifier fundSent () {
        require(msg.value > 0, "msg.value must be > 0");
        _;
    }

    modifier futureEndtime (uint endtime) {
        require(endtime > block.timestamp, "endtime time must be in the future");
        _;
    }

    modifier isLockedContractExist (bytes32 lockedContractID) {
        require(haveLockedContract(lockedContractID), "lockedContractID does not exist");
        _;
    }

    modifier checkSecretHashMatches (bytes32 lockedContractID, string memory preimage) {
        require(
            lockedContracts[lockedContractID].secretHash == sha256(abi.encodePacked(preimage)), 
            "secret hash does not match");
        _;
    }

    modifier withdrawable (bytes32 lockedContractID) {
        require(lockedContracts[lockedContractID].recipient == msg.sender, "withdrawable: not recipient");
        require(lockedContracts[lockedContractID].withdrawn == false, "withdrawable: already withdrawn");
        require(lockedContracts[lockedContractID].refunded == false, "withdrawable: already refunded");
        _;
    }

    modifier refundable (bytes32 lockedContractID) {
        require(lockedContracts[lockedContractID].sender == msg.sender, "refundable: not sender");
        require(lockedContracts[lockedContractID].refunded == false, "refundable: already refunded");
        require(lockedContracts[lockedContractID].withdrawn == false, "refundable: already withdrawn");
        require(lockedContracts[lockedContractID].endtime <= block.timestamp, "refundable: endtime not yet passed");
        _;
    }


    /**
     * @dev Sender sets up a new Hash Time Lock Contract (HTLC) and depositing the ETH coin.
     *
     * @param secretHash A sha256 secret hash.
     * @param recipient Recipient account of the ETH coin.
     * @param sender Sender account of the ETH coin.
     * @param endtime The timestamp that the lock expires at.
     *
     * @return lockedContractID of the new HTLC.
     */
    function fund (bytes32 secretHash, address payable recipient, address payable sender, uint endtime) external payable fundSent futureEndtime (endtime) returns (bytes32 lockedContractID) {

        require(msg.sender == sender, "msg.sender must be same with sender address");

        lockedContractID = sha256(abi.encodePacked(
            secretHash, recipient, msg.sender, endtime, msg.value
        ));

        if (haveLockedContract(lockedContractID))
            revert("this locked contract already exists");
        
        lockedContracts[lockedContractID] = LockedContract(
            secretHash, recipient, sender, endtime, msg.value, false, false, ""
        );

        emit LogFund(lockedContractID, secretHash, recipient, sender, endtime, msg.value);
        return lockedContractID;
    }


    /**
     * @dev Called by the recipient once they know the preimage (secret key) of the secret hash.
     *
     * @param lockedContractID of HTLC to withdraw.
     * @param preimage sha256(preimage) hash should equal the contract secret hash.
     *
     * @return bool true on success or false on failure.
     */
    function withdraw (bytes32 lockedContractID, string memory preimage) external isLockedContractExist (lockedContractID) checkSecretHashMatches (lockedContractID, preimage) withdrawable (lockedContractID) returns (bool) {

        LockedContract storage lockedContract = lockedContracts[lockedContractID];

        lockedContract.preimage = preimage;
        lockedContract.withdrawn = true;
        lockedContract.recipient.transfer(lockedContract.amount);

        emit LogWithdraw(lockedContractID);
        return true;
    }


    /**
     * @dev Called by the sender if there was no withdraw and the time lock has expired.
     *
     * @param lockedContractID of HTLC to refund.

     * @return bool true on success or false on failure.
     */
    function refund (bytes32 lockedContractID) external isLockedContractExist (lockedContractID) refundable (lockedContractID) returns (bool) {

        LockedContract storage lockedContract = lockedContracts[lockedContractID];

        lockedContract.refunded = true;
        lockedContract.sender.transfer(lockedContract.amount);

        emit LogRefund(lockedContractID);
        return true;
    }


    /**
     * @dev Get HTLC contract details.
     *
     * @param lockedContractID of HTLC to get details.
     *
     * @return id secretHash recipient sender withdrawn refunded preimages locked HTCL contract datas.
     */
    function getLockedContract (bytes32 lockedContractID) public view returns (
        bytes32 id, bytes32 secretHash, address recipient, address sender, uint endtime, uint amount, bool withdrawn, bool refunded, string memory preimage
    ) {
        if (haveLockedContract(lockedContractID) == false)
            return (0, 0, address(0), address(0), 0, 0, false, false, "");
        
        LockedContract storage lockedContract = lockedContracts[lockedContractID];

        return (
            lockedContractID,
            lockedContract.secretHash,
            lockedContract.recipient,
            lockedContract.sender,
            lockedContract.endtime,
            lockedContract.amount,
            lockedContract.withdrawn,
            lockedContract.refunded,
            lockedContract.preimage
        );
    }


    /**
     * @dev Is there a locked contract with HTLC contract id.
     *
     * @param lockedContractID of HTLC to find it exists.
     *
     * @return exists boolean true or false.
     */
    function haveLockedContract (bytes32 lockedContractID) internal view returns (bool exists) {
        exists = (lockedContracts[lockedContractID].sender != address(0));
    }
}