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

  const gasPrice = 130000000000;

  const GNOSIS = '0xBb22A47842EaFc967213269280509A8B28e57076';

  // Deploy pool controller implementation
  await deploy('CommitteeProxy', 'committeeProxy', {
    from: deployer,
    gas: 4000000,
    gasPrice,
    args: [GNOSIS]
  });
};

module.exports.tags = ['CommitteeProxy'];