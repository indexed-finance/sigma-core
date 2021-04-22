const { toWei, expect, verifyRejection, zeroAddress } = require("../utils");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('ScoreByCMCBarbell6.sol', () => {
  let circulatingMarketCapOracle, scoringStrategy;
  let notOwner;

  before(async () => {
    ([, notOwner] = await ethers.getSigners()
      .then(async (signers) => Promise.all(
        signers.map(async (signer) => Object.assign(signer, { address: await signer.getAddress() })))
    ));
  })

  function setupTests() {
    before(async () => {
      circulatingMarketCapOracle = await deploy('MockCirculatingCapOracle');
      scoringStrategy = await deploy('ScoreByCMCBarbell6', circulatingMarketCapOracle.address);
      verifyRevert = (...args) => verifyRejection(scoringStrategy, ...args);
    })
  }

  describe('setCirculatingMarketCapOracle()', () => {
    setupTests();

    it('Reverts if not called by owner', async () => {
      await verifyRejection(
        scoringStrategy.connect(notOwner),
        'setCirculatingMarketCapOracle',
        /Ownable: caller is not the owner/g,
        zeroAddress
      );
    });

    it('Sets new oracle', async () => {
      await scoringStrategy.setCirculatingMarketCapOracle(zeroAddress);
      expect(await scoringStrategy.circulatingMarketCapOracle()).to.eq(zeroAddress);
    })
  })

  describe('getTokenScores()', () => {
    setupTests();

    it('Reverts if given less than 6 tokens', async () => {
      await verifyRejection(
        scoringStrategy,
        'getTokenScores',
        /Not enough tokens/g,
        [zeroAddress, zeroAddress, zeroAddress, zeroAddress]
      );
    })

    it('Returns token market caps as scores', async () => {
      const tokens = [];
      const caps = [];
      for (let i = 0; i < 20; i++) {
        const token = `0x${(i + 1).toString(16).padStart(40, '0')}`;
        tokens.push(token);
        const amount = toWei((i + 3) * 20);
        caps.push(amount);
      }
      await circulatingMarketCapOracle.setCirculatingMarketCaps(tokens, caps);
      const scores = await scoringStrategy.getTokenScores(tokens);
      for (let i = 0; i < 14; i++) {
        expect(scores[i].eq(0)).to.be.true;
      }
      expect(scores[14].eq(25)).to.be.true;
      expect(scores[15].eq(15)).to.be.true;
      expect(scores[16].eq(10)).to.be.true;
      expect(scores[17].eq(10)).to.be.true;
      expect(scores[18].eq(15)).to.be.true;
      expect(scores[19].eq(25)).to.be.true;
    })

    it('Produces barbell scores that sum up to 100', async () => {
      barbellSum = 0;
      for (let i = 0; i < 20; i++) {
        barbellSum += scores[i];
      }
      expect(barbellSum.eq(100)).to.be.true;
    })
  })
})