This is an implementation of the crosschannel in Solidity without implementing relayers.

The crosschannel contracts consist of a bridge contract used for relaying transactions between two blockchains, a channel contract used for maintaining crosschannels, and a deposit contract used for user register.
The bridge contract is not implemented inextenso since several processes of relayers, such as random selection or multiple signatures, are not included.