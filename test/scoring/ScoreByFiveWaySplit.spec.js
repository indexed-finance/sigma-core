const { toWei, expect, verifyRejection, zeroAddress, expandTo18Decimals } = require("../utils");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('ScoreByFiveWaySplit.sol', () => {
  let scoringStrategy;
  let notOwner;

  before(async () => {
    ([, notOwner] = await ethers.getSigners()
      .then(async (signers) => Promise.all(
        signers.map(async (signer) => Object.assign(signer, { address: await signer.getAddress() })))
    ));
  })

  function setupTests() {
    before(async () => {
      scoringStrategy = await deploy('ScoreByFiveWaySplit');
      verifyRevert = (...args) => verifyRejection(scoringStrategy, ...args);
    })
  }
  describe('getTokenScores()', () => {
    setupTests();

    it('Reverts if given less than 5 tokens', async () => {
      await verifyRejection(
        scoringStrategy,
        'getTokenScores',
        /Must provide 5 tokens/g,
        [zeroAddress, zeroAddress, zeroAddress, zeroAddress]
      );
    })

    it('Reverts if given more than 5 tokens', async () => {
      await verifyRejection(
        scoringStrategy,
        'getTokenScores',
        /Must provide 5 tokens/g,
        [zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress]
      );
    })

    it('Returns an array of 5x 1e18', async () => {
      const scores = await scoringStrategy.getTokenScores([zeroAddress, zeroAddress, zeroAddress, zeroAddress, zeroAddress]);
      const ONE = expandTo18Decimals(1);
      expect(scores[0].eq(ONE)).to.be.true;
      expect(scores[1].eq(ONE)).to.be.true;
      expect(scores[2].eq(ONE)).to.be.true;
      expect(scores[3].eq(ONE)).to.be.true;
      expect(scores[4].eq(ONE)).to.be.true;
    })
  })
})