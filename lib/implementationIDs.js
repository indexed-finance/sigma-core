const { sha3 } = require('../test/utils');

module.exports = {
  poolInitializerID: sha3('SigmaPoolInitializerV1.sol'),
  poolImplementationID: sha3('SigmaIndexPoolV1.sol'),
  sellerImplementationID: sha3('SigmaUnboundTokenSellerV1.sol'),
  controllerImplementationSalt: sha3('SigmaControllerV1.sol')
}
