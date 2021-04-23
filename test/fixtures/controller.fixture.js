const [...testTokens] = require('../testData/test-tokens.json');

const { verifyRejection, getFakerContract, toWei, oneE18, sha3 } = require('../utils');
const { uniswapFixture } = require('./uniswap.fixture');
const {
  controllerImplementationSalt,
  poolInitializerID,
  poolImplementationID,
  sellerImplementationID,
} = require('../../lib/implementationIDs');

const toLiquidityAmounts = ({ price, marketcap }, init = false) => {
  let amountWeth = toWei(marketcap);
  let amountToken = amountWeth.mul(oneE18).div(toWei(price));
  if (!init) {
    amountWeth = amountWeth.div(10);
    amountToken = amountToken.div(10);
  }
  return { amountToken, amountWeth };
}

const controllerFixture = async ({ deployments, getNamedAccounts, ethers }) => {
  const { deployer, feeRecipient } = await getNamedAccounts();
  const [ signer, signer1, signer2 ] = await ethers.getSigners();
  const uniswapResult = await deployments.createFixture(uniswapFixture)();
  const { uniswapRouter, uniswapOracle, deployTokenAndMarket, addLiquidity, updatePrices } = uniswapResult;

  const deploy = async (name, ...args) => (await ethers.getContractFactory(name, signer)).deploy(...args);

  // Deploy proxy manager
  const proxyManager = await deploy('DelegateCallProxyManager');

  // Deploy pool factory
  const poolFactory = await deploy('PoolFactory', proxyManager.address);

  const circulatingCapOracle = await deploy('MockCirculatingCapOracle');
  const circuitBreaker = await signer1.getAddress();
  const fdvScoring = await deploy('ScoreByFDV', uniswapOracle.address);
  const fdvSqrtScoring = await deploy('ScoreBySqrtFDV', uniswapOracle.address);
  const cmcScoring = await deploy('ScoreByCMC', circulatingCapOracle.address);
  const cmcSqrtScoring = await deploy('ScoreBySqrtCMC', circulatingCapOracle.address);

  // Deploy pool controller
  const controllerImplementation = await deploy('SigmaControllerV1', uniswapOracle.address, poolFactory.address, proxyManager.address, feeRecipient);
  const controllerAddress = await proxyManager.computeProxyAddressOneToOne(deployer, controllerImplementationSalt);
  await proxyManager.deployProxyOneToOne(controllerImplementationSalt, controllerImplementation.address);
  const controller = await ethers.getContractAt('SigmaControllerV1', controllerAddress);
  await controller[`initialize(address)`](circuitBreaker);

  const tokenSellerImplementation = await deploy('SigmaUnboundTokenSellerV1', uniswapRouter.address, uniswapOracle.address);
  await proxyManager.createManyToOneProxyRelationship(
    sellerImplementationID,
    tokenSellerImplementation.address,
    { gasLimit: 400000 }
  ).then(r => r.wait());

  const poolImplementation = await deploy('SigmaIndexPoolV1');

  await proxyManager.createManyToOneProxyRelationship(
    poolImplementationID,
    poolImplementation.address,
    { gasLimit: 400000 }
  ).then(r => r.wait());

  const poolInitializerImplementation = await deploy('SigmaPoolInitializerV1', uniswapOracle.address);

  await proxyManager.createManyToOneProxyRelationship(
    poolInitializerID,
    poolInitializerImplementation.address,
    { gasLimit: 750000 }
  ).then(r => r.wait());

  await proxyManager.approveDeployer(poolFactory.address, { gasLimit: 60000 }).then(r => r.wait());
  await proxyManager.approveDeployer(controller.address, { gasLimit: 60000 }).then(r => r.wait());
  await poolFactory.approvePoolController(controller.address, { gasLimit: 60000 }).then(r => r.wait());

  const wrappedTokens = [];

  for (let tokenInfo of testTokens) {
    const { marketcap, name, symbol, price } = tokenInfo;
    if (!marketcap || !name || !symbol || !price) {
      throw new Error(`Token JSON must include: marketcap, name, symbol, price`);
    }
    const tokenAndPairData = await deployTokenAndMarket(name, symbol);
    const { amountToken, amountWeth } = toLiquidityAmounts(tokenInfo, true);
    await addLiquidity(tokenAndPairData.token, amountToken, amountWeth);
    wrappedTokens.push({
      ...tokenAndPairData,
      ...tokenInfo
    });
  }
  await updatePrices(wrappedTokens);
  const addLiquidityAll = async () => {
    for (let token of wrappedTokens) {
      const { amountToken, amountWeth } = toLiquidityAmounts(token, false);
      await addLiquidity(token, amountToken, amountWeth)
    }
  }

  const verifyRevert = (...args) => verifyRejection(controller, ...args);
  const nonOwnerFaker = getFakerContract(controller, signer2);
  const ownerFaker = getFakerContract(controller);

  return {
    ...uniswapResult,
    circuitBreaker: signer1,
    circulatingCapOracle,
    wrappedTokens,
    proxyManager,
    poolFactory,
    controller,
    from: deployer,
    feeRecipient,
    verifyRevert,
    nonOwnerFaker,
    addLiquidityAll,
    ownerFaker,
    initializerImplementation: poolInitializerImplementation.address,
    fdvScoring,
    fdvSqrtScoring,
    cmcScoring,
    cmcSqrtScoring
  };
};

module.exports = { controllerFixture };
