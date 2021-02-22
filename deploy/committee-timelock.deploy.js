const Logger = require('../lib/logger');
const Deployer = require('../lib/deployer');

const { controllerImplementationSalt } = require('../lib/implementationIDs');

module.exports = async (bre) => {
  const {
    deployments,
    getChainId,
    getNamedAccounts,
    ethers
  } = bre;
  const { deployer } = await getNamedAccounts();

  const chainID = +(await getChainId());
  const logger = Logger(chainID)
  const deploy = await Deployer(bre, logger);

  const gasPrice = 250000000000;

  const GNOSIS = '0xBb22A47842EaFc967213269280509A8B28e57076';
  const INDEXED_TIMELOCK = '0x78a3eF33cF033381FEB43ba4212f2Af5A5A0a2EA';

  const DELAY = 86400 * 7;

  // Deploy pool controller implementation
  await deploy('CommitteeTimelock', 'committeeTimelock', {
    from: deployer,
    gas: 4000000,
    gasPrice,
    args: [GNOSIS, INDEXED_TIMELOCK, DELAY]
  });
};

module.exports.tags = ['CommitteeTimelock'];