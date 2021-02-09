const { defaultAbiCoder, keccak256 } = require("ethers/lib/utils");
const { zeroAddress, toWei, verifyRejection, expect, expectEvent } = require("./utils");

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('CommitteeProxy.sol', async () => {
  let owner, committee, notOwner;
  let proxy, token;

  function setupTests() {
    before(async () => {
      (
        [owner, committee, notOwner] = await ethers.getSigners()
        .then(async (signers) => Promise.all(
          signers.map(async (signer) => Object.assign(signer, { address: await signer.getAddress() })))
        )
      );
      proxy = await deploy('CommitteeProxy', committee.address);
      token = await deploy('MockERC20', 'Token', 'TKN');
      await token.getFreeTokens(proxy.address, toWei(1000));
    });
  }

  describe('Constructor & Settings', () => {
    setupTests();

    it('committee', async () => {
      expect(await proxy.committee()).to.eq(committee.address);
    })

    it('owner', async () => {
      expect(await proxy.owner()).to.eq(owner.address);
    })
  })

  describe('setCommittee()', () => {
    setupTests();

    it('Reverts if not called by owner', async () => {
      await verifyRejection(proxy.connect(notOwner), 'setCommittee', /Ownable: caller is not the owner/g, zeroAddress)
    })

    it('Sets the committee', async () => {
      const tx = await proxy.setCommittee(notOwner.address);
      expect(await proxy.committee()).to.eq(notOwner.address)
      expectEvent(tx, 'CommitteeChanged')
    })
  })

  describe('executeTransaction()', async () => {
    setupTests();

    it('Reverts if not called by committee', async () => {
      await verifyRejection(
        proxy,
        'executeTransaction',
        /CommitteeProxy: caller is not the committee/g,
        zeroAddress,
        0,
        '',
        '0x'
      )
    })

    it('Executes transaction with function signature', async () => {
      await proxy.connect(committee).executeTransaction(
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notOwner.address, toWei(500)])
      );
      expect((await token.balanceOf(notOwner.address)).eq(toWei(500))).to.be.true;
    })

    it('Executes transaction without function signature', async () => {
      const fnSig = keccak256(Buffer.from('transfer(address,uint256)')).slice(0, 10);
      const calldata = defaultAbiCoder.encode(['address', 'uint256'], [notOwner.address, toWei(500)]);
      const data = fnSig.concat(calldata.slice(2))
      await proxy.connect(committee).executeTransaction(
        token.address,
        0,
        '',
        data
      );
      expect((await token.balanceOf(notOwner.address)).eq(toWei(1000))).to.be.true;
    })

    it('Reverts if the call fails', async () => {
      await verifyRejection(
        proxy.connect(committee),
        'executeTransaction',
        /CommitteeProxy::executeTransaction: Transaction execution reverted/g,
        token.address,
        0,
        'transfer(address,uint256)',
        defaultAbiCoder.encode(['address', 'uint256'], [notOwner.address, toWei(500)])
      )
    })
  })
});