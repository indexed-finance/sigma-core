const Logger = require('../lib/logger');
const Deployer = require('../lib/deployer');
const { sha3 } = require('../test/utils');

const poolImplementationID = sha3('SigmaIndexPoolV1.sol');

module.exports = async (bre) => {
  const {
    deployments,
    getChainId,
    getNamedAccounts,
    ethers
  } = bre;
  const { deployer } = await getNamedAccounts();
  const [ signer ] = await ethers.getSigners();

  const chainID = +(await getChainId());
  const logger = Logger(chainID)
  const deploy = await Deployer(bre, logger);

  const gasPrice = (chainID == 1) ? 35000000000 : 1000000000;

  const proxyManager = await ethers.getContract('proxyManager', signer);

  const poolImplementation = await deploy('SigmaIndexPoolV1', 'poolImplementation', {
    from: deployer,
    gas: 4000000,
    gasPrice,
    nonce: 12,
    args: []
  });

  await proxyManager.createManyToOneProxyRelationship(
    poolImplementationID,
    poolImplementation.address,
    { gasPrice, gasLimit: 150000 }
  ).then(r => r.wait());
  logger.success(`Created implementation for pool`);
};

module.exports.tags = ['SigmaIndexPoolV1'];
