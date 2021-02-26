const { toWei, expect, verifyRejection, zeroAddress, fastForward, sqrt } = require("../utils");
const { categoriesFixture } = require("../fixtures/categories.fixture");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('ScoreBySqrtFDV.sol', () => {
  let updatePrices, wrappedTokens, oracle;
  let addLiquidityAll;
  let scoringStrategy;
  let liquidityManager;

  function setupTests() {
    before(async () => {
      ({
        updatePrices,
        tokens: wrappedTokens,
        uniswapOracle: oracle,
        deployTokenAndMarket,
        addLiquidityAll,
        addLiquidity,
        liquidityManager
      } = await deployments.createFixture(categoriesFixture)());
      scoringStrategy = await deploy('ScoreBySqrtFDV', oracle.address);
      verifyRevert = (...args) => verifyRejection(scoringStrategy, ...args);
      await addLiquidityAll();
      await updatePrices(wrappedTokens);
      await fastForward(86400 * 1.1);
      await addLiquidityAll();
    })
  }

  describe('Settings', async () => {
    setupTests();

    it('LONG_TWAP_MIN_TIME_ELAPSED()', async () => {
      expect(await scoringStrategy.LONG_TWAP_MIN_TIME_ELAPSED()).to.eq(86400);
    })

    it('LONG_TWAP_MAX_TIME_ELAPSED()', async () => {
      expect(await scoringStrategy.LONG_TWAP_MAX_TIME_ELAPSED()).to.eq(86400 * 10.5);
    })

    it('uniswapOracle()', async () => {
      expect(await scoringStrategy.uniswapOracle()).to.eq(oracle.address)
    })
  })

  describe('getTokenScores()', () => {
    setupTests();

    it('Returns token market caps as scores', async () => {
      const expectedMarketCaps = await Promise.all(
        wrappedTokens.map(
          async ({ token }) => liquidityManager.getTokenValue(token.address, await token.totalSupply())
        )
      );
      const scores = await scoringStrategy.getTokenScores(wrappedTokens.map(t => t.address));
      for (let i = 0; i < wrappedTokens.length; i++) {
        expect(scores[i].eq(sqrt(expectedMarketCaps[i]))).to.be.true;
      }
    })
  })
})