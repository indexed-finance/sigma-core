const { toWei, expect, verifyRejection, zeroAddress } = require("../utils");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('ScoreByCMCPegged20.sol', () => {
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
      scoringStrategy = await deploy('ScoreByCMCPegged20', circulatingMarketCapOracle.address);
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

    it('Reverts if given less than 5 tokens', async () => {
      await verifyRejection(
        scoringStrategy,
        'getTokenScores',
        /Not enough tokens/g,
        [zeroAddress, zeroAddress, zeroAddress, zeroAddress]
      );
    })

    it('Returns scaled scores with pegged values for highest two CMCs as scores', async () => {
      const tokens = [];
      const caps = [];
      for (let i = 0; i < 5; i++) {
        const token = `0x${(i + 1).toString(16).padStart(40, '0')}`;
        tokens.push(token);
        if (i < 2) {
          caps.push(toWei((100 / (i + 1)) * 100));
        } else {
          caps.push(toWei(i * 10));
        }
      }
      await circulatingMarketCapOracle.setCirculatingMarketCaps(tokens, caps);
      const scores = await scoringStrategy.getTokenScores(tokens);
      expect(scores[0].eq(18)).to.be.true;
      expect(scores[1].eq(18)).to.be.true;
      expect(scores[2].eq(12)).to.be.true;
      expect(scores[3].eq(18)).to.be.true;
      expect(scores[4].eq(24)).to.be.true;
    })
  })
})