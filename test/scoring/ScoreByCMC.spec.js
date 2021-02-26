const { toWei, expect, verifyRejection, zeroAddress } = require("../utils");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('ScoreByCMC.sol', () => {
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
      scoringStrategy = await deploy('ScoreByCMC', circulatingMarketCapOracle.address);
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
      for (let i = 0; i < 20; i++) {
        expect(scores[i].eq(caps[i])).to.be.true;
      }
    })
  })
})