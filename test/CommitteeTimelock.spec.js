const { toWei, expect, verifyRejection, fastForward } = require("./utils");
const { defaultAbiCoder } = require('ethers/lib/utils');

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

const DAY = 86400;

const DELAY = 7 * DAY;
const GRACE_PERIOD = 14 * DAY;
const MINIMUM_DELAY = 2 * DAY;
const MAXIMUM_DELAY = 30 * DAY;

describe('CommitteeTimelock.sol', async () => {
  let admin, superUser, notAdmin;
  let timelock, token;

  function setupTests() {
    before(async () => {
      ([admin, superUser, notAdmin] = await ethers.getSigners()
      .then(async (signers) => Promise.all(
        signers.map(async (signer) => Object.assign(signer, { address: await signer.getAddress() })))
      ));
      timelock = await deploy('CommitteeTimelock', admin.address, superUser.address, DELAY);
      token = await deploy('MockERC20', 'TestToken', 'Token');
    });
  }

  describe('Constructor & Settings', async () => {
    setupTests();

    it('admin', async () => {
      expect(await timelock.admin()).to.eq(admin.address);
    })

    it('superUser', async () => {
      expect(await timelock.superUser()).to.eq(superUser.address);
    })

    it('delay', async () => {
      expect((await timelock.delay()).eq(DELAY)).to.be.true
    })

    it('GRACE_PERIOD', async () => {
      expect((await timelock.GRACE_PERIOD()).eq(GRACE_PERIOD)).to.be.true;
    })

    it('MINIMUM_DELAY', async () => {
      expect((await timelock.MINIMUM_DELAY()).eq(MINIMUM_DELAY)).to.be.true;
    })

    it('MAXIMUM_DELAY', async () => {
      expect((await timelock.MAXIMUM_DELAY()).eq(MAXIMUM_DELAY)).to.be.true
    })
  })

  describe('queueTransaction()', async () => {
    setupTests();

    it('reverts if not an admin', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await verifyRejection(
        timelock.connect(notAdmin),
        'queueTransaction',
        /CommitteeTimelock::isAdmin: Call must come from admin or superUser\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        timestamp + DELAY + 100
      )
    })

    it('can be called by superUser', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await timelock.connect(superUser).queueTransaction(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        timestamp + DELAY + 100
      )
    })

    it('can be called by admin', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await timelock.queueTransaction(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        timestamp + DELAY + 100
      )
    })
  })

  describe('executeTransaction()', async () => {
    setupTests();
    let eta;

    it('reverts if not an admin', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await verifyRejection(
        timelock.connect(notAdmin),
        'executeTransaction',
        /CommitteeTimelock::isAdmin: Call must come from admin or superUser\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        timestamp + DELAY + 100
      );
    });

    it('reverts if transaction with same txHash not queued', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      await verifyRejection(
        timelock,
        'executeTransaction',
        /CommitteeTimelock::executeTransaction: Transaction hasn't been queued\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        timestamp + DELAY + 100
      );
    });

    it('reverts if timelock has not passed', async () => {
      const { timestamp } = await ethers.provider.getBlock('latest');
      eta = timestamp + DELAY + 100;
      await timelock.queueTransaction(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        eta
      );
      await verifyRejection(
        timelock,
        'executeTransaction',
        /CommitteeTimelock::executeTransaction: Transaction hasn't surpassed time lock\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        eta
      );
    });

    it('reverts if tx call fails', async () => {
      await fastForward(DELAY + 100);
      await verifyRejection(
        timelock,
        'executeTransaction',
        /CommitteeTimelock::executeTransaction: Transaction execution reverted\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        eta
      );
    })

    it('can execute after the timelock passes', async () => {
      await token.getFreeTokens(timelock.address, toWei(1000))
      await timelock.executeTransaction(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)]),
        eta
      );
      expect((await token.balanceOf(notAdmin.address)).eq(toWei(1000))).to.be.true;
    })
  })

  describe('sudo()', async () => {
    setupTests();

    it('reverts if not called by superUser', async () => {
      await verifyRejection(
        timelock,
        'sudo',
        /CommitteeTimelock::sudo: Caller is not superUser\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)])
      )
    });

    it('reverts if tx call fails', async () => {
      await verifyRejection(
        timelock.connect(superUser),
        'sudo',
        /CommitteeTimelock::executeTransaction: Transaction execution reverted\./g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)])
      );
    });

    it('allows superUser to immediately execute a tx', async () => {
      await token.getFreeTokens(timelock.address, toWei(1000));
      await timelock.connect(superUser).sudo(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notAdmin.address, toWei(1000)])
      );
      expect((await token.balanceOf(notAdmin.address)).eq(toWei(1000))).to.be.true;
    });
  })
});