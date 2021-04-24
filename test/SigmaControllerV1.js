const { BigNumber } = require('ethers');
const { controllerFixture } = require('./fixtures/controller.fixture');
const { verifyRejection, expect, fastForward, fromWei, toWei, zero, zeroAddress, oneE18, sqrt, sha3, WEEK, toFP, fromFP } = require('./utils');

const { calcRelativeDiff } = require('./lib/calc_comparisons');
const errorDelta = 10 ** -8;

const WEIGHT_MULTIPLIER = toWei(25);

const absDiff = (a, b) => {
  return a.sub(b).abs().toNumber();
}

describe('SigmaControllerV1.sol', async () => {
  let controller, from, feeRecipient, governance, circuitBreaker, verifyRevert;
  let nonOwnerFaker, ownerFaker;
  let updatePrices, addLiquidityAll, liquidityManager;
  let sortedWrappedTokens;
  let wrappedTokens, tokens, initializerImplementation;
  let pool, initializer, tokenSeller;
  let poolSize;
  let notOwner;
  let circulatingCapOracle;
  let fdvScoring, fdvSqrtScoring, cmcScoring, cmcSqrtScoring;

  const setupTests = (options = {}) => {

    before(async () => {
      ([,, governance] = await ethers.getSigners());
      ({
        circuitBreaker,
        poolFactory,
        proxyManager,
        circulatingCapOracle,
        wrappedTokens,
        controller,
        from,
        verifyRevert,
        nonOwnerFaker,
        updatePrices,
        addLiquidityAll,
        addLiquidity,
        ownerFaker,
        initializerImplementation,
        liquidityManager,
        fdvScoring,
        fdvSqrtScoring,
        cmcScoring,
        cmcSqrtScoring,
        feeRecipient
      } = await deployments.createFixture(controllerFixture)());
      const defaultOptions = {
        init: false,
        pool: false,
        category: false,
        size: undefined,
        useFullyDiluted: true,
        useSqrt: true,
        ethValue: undefined,
        setRecipient: true
      };
      const { init, pool, category, size, ethValue, useFullyDiluted, useSqrt, setRecipient } = Object.assign(defaultOptions, options);
      tokens = wrappedTokens.map(t => t.address);
      if (!useFullyDiluted) {
        sortedWrappedTokens = [
          ...wrappedTokens.map((t, i) => ({
            ...t,
            marketCap: BigNumber.from(t.address.slice(0, 10)).div(2)
          }))
        ];
        await circulatingCapOracle.setCirculatingMarketCaps(
          sortedWrappedTokens.map(t => t.address),
          sortedWrappedTokens.map(t => t.marketCap)
        );
        sortedWrappedTokens = sortedWrappedTokens.sort((a, b) => {
          if (a.marketCap.lt(b.marketCap)) return 1;
          if (a.marketCap.gt(b.marketCap)) return -1;
          return 0;
        });
      } else {
        sortedWrappedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
      }
      if (setRecipient) {
        await controller.connect(governance).setDefaultExitFeeRecipient(feeRecipient);
      }
      if (category) await setupCategory(useFullyDiluted, useSqrt);
      if (pool) await setupPool(size, ethValue, useSqrt);
      if (init) await finishInitializer();
      [,,notOwner] = await ethers.getSigners();
    });
  }

  const getMarketCaps = (_tokens, useFullyDiluted = true) => {
    if (useFullyDiluted) {
      return Promise.all(_tokens.map(
        async (token) => liquidityManager.getTokenValue(
          token,
          await (await ethers.getContractAt('IERC20', token)).totalSupply()
        )
      ));
    } else {
      return circulatingCapOracle.getCirculatingMarketCaps(_tokens);
    }
  }

  const sortTokens = async (fullyDiluted = true) => {
    await updatePrices(wrappedTokens);
    const t = [ ...wrappedTokens ];
    const caps = await getMarketCaps(t.map(_ => _.address), fullyDiluted);
    caps.forEach((cap, i) => t[i].marketCap = cap);
    sortedWrappedTokens = t.sort((a, b) => {
      if (a.marketCap.lt(b.marketCap)) return 1;
      if (a.marketCap.gt(b.marketCap)) return -1;
      return 0;
    });
  }

  const getMarketCapSqrts = async (_tokens, fullyDiluted = true) => {
    const actualMarketCaps = await getMarketCaps(_tokens.map(_ => _.address), fullyDiluted);
    const capSqrts = actualMarketCaps.map(sqrt);
    const sqrtSum = capSqrts.reduce((total, capSqrt) => total.add(capSqrt), BigNumber.from(0));
    return [capSqrts, sqrtSum];
  }

  const getExpectedTokensAndBalances = async (numTokens, ethValue, useSqrt = true, fullyDiluted = true) => {
    // await addLiquidityAll();
    const expectedTokens = sortedWrappedTokens.slice(0, numTokens);
    let weightedEthValues = [];
    if (useSqrt) {
      const [capSqrts, sqrtSum] = await getMarketCapSqrts(expectedTokens, fullyDiluted);
      weightedEthValues = capSqrts.map((rt) => rt.mul(ethValue).div(sqrtSum));
    } else {
      const mcaps = await getMarketCaps(expectedTokens.map(t => t.address), fullyDiluted);
      const mcapSum = mcaps.reduce((t, m) => t.add(m), BigNumber.from(0));
      weightedEthValues = mcaps.map((rt) => rt.mul(ethValue).div(mcapSum));
    }
    const expectedBalances = weightedEthValues.map((val, i) => {
      const _price = toWei(expectedTokens[i].price);
      return val.mul(oneE18).div(_price);
    });
    return [expectedTokens.map(t => t.address), expectedBalances];
  };

  const setupCategory = async (useFullyDilutedMarketCaps = true, useSqrt = true, minCap = 1, maxCap = toWei(100000000)) => {
    await addLiquidityAll();
    let scoringStrategy;
    if (useFullyDilutedMarketCaps) {
      if (useSqrt) scoringStrategy = fdvSqrtScoring;
      else scoringStrategy = fdvScoring;
    } else {
      if (useSqrt) scoringStrategy = cmcSqrtScoring;
      else scoringStrategy = cmcScoring;
    }
    await controller.createTokenList(`0x${'ff'.repeat(32)}`, scoringStrategy.address, minCap, maxCap);
    const index = await controller.tokenListCount();
    await controller.addTokens(index, tokens);
    await fastForward(3600 * 48);
    await addLiquidityAll();
    return index;
  };

  const getExpectedDenorms = async (numTokens, useFullyDilutedMarketCaps = true, useSqrt = true) => {
    const expectedTokens = sortedWrappedTokens.slice(0, numTokens);
    let denorms;
    if (useSqrt) {
      const [capSqrts, sqrtSum] = await getMarketCapSqrts(expectedTokens, useFullyDilutedMarketCaps);
      denorms = capSqrts.map((rt) => fromFP(toFP(rt).div(sqrtSum).mul(WEIGHT_MULTIPLIER)));
    } else {
      const mcaps = await getMarketCaps(expectedTokens.map(t => t.address), useFullyDilutedMarketCaps);
      const mcapSum = mcaps.reduce((t, m) => t.add(m), BigNumber.from(0));
      denorms = mcaps.map((rt) => fromFP(toFP(rt).div(mcapSum).mul(WEIGHT_MULTIPLIER)));
    }
    return denorms
  }

  const changePrices = async (fullyDiluted = true) => {
    const valuesBefore = [];
    const shouldMoves = [];
    const newCaps = [];
    const existingCaps = await circulatingCapOracle.getCirculatingMarketCaps(
      sortedWrappedTokens.map(t => t.address)
    );
    for (let i = 0; i < sortedWrappedTokens.length; i++) {
      const {address} = sortedWrappedTokens[i];
      const movePriceUp = i >= poolSize;//Math.random() > 0.5;
      shouldMoves.push(movePriceUp);
      const valueBefore = liquidityManager.getTokenValue(address, toWei(1));
      valuesBefore.push(valueBefore);
      await liquidityManager[movePriceUp ? 'swapIncreasePrice' : 'swapDecreasePrice'](address);
      newCaps.push(existingCaps[i][movePriceUp ? 'add' : 'sub'](existingCaps[i].div(3)))
    }
    if (!fullyDiluted) {
      await circulatingCapOracle.setCirculatingMarketCaps(sortedWrappedTokens.map(t => t.address), newCaps);
    }
    await updatePrices(tokens);
  };

  const prepareReweigh = async (_changePrices = false, fullyDiluted = true) => {
    await updatePrices(tokens);
    await fastForward(WEEK * 2);
    if (_changePrices) {
      await changePrices(fullyDiluted);
    } else {
      await addLiquidityAll();
      await updatePrices(tokens)
    }
    await fastForward(3600 * 48);
    await addLiquidityAll();
  }

  const finishInitializer = async () => {
    await updatePrices(wrappedTokens);
    await fastForward(7200);
    await addLiquidityAll();
    const desiredTokens = await initializer.getDesiredTokens();
    const desiredAmounts = await initializer.getDesiredAmounts(desiredTokens);
    for (let i = 0; i < desiredTokens.length; i++) {
      const token = await ethers.getContractAt('MockERC20', desiredTokens[i]);
      await token.getFreeTokens(from, desiredAmounts[i]);
      await token.approve(initializer.address, desiredAmounts[i]);
    }
    await initializer['contributeTokens(address[],uint256[],uint256)'](desiredTokens, desiredAmounts, 0);
    await initializer.finish();
    await initializer['claimTokens()']();
    const myBal = await pool.balanceOf(from);
    expect(myBal.eq(toWei(100))).to.be.true;
    expect(await pool.isPublicSwap()).to.be.true;
    const defaultPremium = await controller.defaultSellerPremium();
    const sellerAddress = await controller.computeSellerAddress(pool.address);
    tokenSeller = await ethers.getContractAt('SigmaUnboundTokenSellerV1', sellerAddress);
    expect(await tokenSeller.getPremiumPercent()).to.eq(defaultPremium);
  }

  const setupPool = async (size = 5, ethValue = 1) => {
    poolSize = size;
    if ((await controller.tokenListCount()).eq(0)) await setupCategory();
    const { events } = await controller.prepareIndexPool(1, size, toWei(ethValue), 'Test Index Pool', 'TIP').then(tx => tx.wait());
    const { args: { pool: poolAddress, initializer: initializerAddress } } = events.filter(e => e.event == 'NewPoolInitializer')[0];
    pool = await ethers.getContractAt('SigmaIndexPoolV1', poolAddress);
    initializer = await ethers.getContractAt('SigmaPoolInitializerV1', initializerAddress);
    return { poolAddress, initializerAddress };
  }

  describe('Initializer & Settings', async () => {
    setupTests({ setRecipient: false });

    it('defaultSellerPremium(): set to 2', async () => {
      const premium = await controller.defaultSellerPremium();
      expect(premium).to.eq(2);
    });

    it('owner()', async () => {
      expect(await controller.owner()).to.eq(from);
    });

    it('circuitBreaker()', async () => {
      expect(await controller.circuitBreaker()).to.eq(await circuitBreaker.getAddress());
    })

    it('defaultExitFeeRecipient()', async () => {
      expect(await controller.defaultExitFeeRecipient()).to.eq(`0x${'00'.repeat(20)}`);
    })

    it('governance()', async () => {
      expect(await controller.governance()).to.eq(await governance.getAddress());
    })
  });

  describe('onlyOwner', async () => {
    setupTests();

    it('All functions with onlyOwner modifier revert if caller is not owner', async () => {
      const onlyOwnerFns = [
        'prepareIndexPool',
        'setDefaultSellerPremium',
        'updateSellerPremium',
        'setSwapFee',
        'delegateCompLikeTokenFromPool',
        'setCircuitBreaker'
      ];
      for (let fn of onlyOwnerFns) {
        await verifyRejection(nonOwnerFaker, fn, /Ownable: caller is not the owner/g);
      }
    });
  });

  describe('isInitializedPool', async () => {
    setupTests();

    it('All functions with isInitializedPool modifier revert if pool address not recognized', async () => {
      // reweighPool & reindexPool included even though there is no modifier because it uses the same validation
      const onlyOwnerFns = [
        'setSwapFee', 'updateMinimumBalance',
        'reweighPool', 'reindexPool',
        'setPublicSwap', 'delegateCompLikeTokenFromPool',
        'setController', 'setExitFeeRecipient'
    ];
      for (let fn of onlyOwnerFns) {
        await verifyRejection(ownerFaker, fn, /ERR_POOL_NOT_FOUND/g);
      }
    });
  });

  describe('setCircuitBreaker()', async () => {
    setupTests();

    it('Reverts if not owner', async () => {
      await verifyRejection(nonOwnerFaker, 'setDefaultSellerPremium', /Ownable: caller is not the owner/g, zeroAddress);
    });

    it('Sets circuit breaker address', async () => {
      const newBreaker = `0x${'11'.repeat(20)}`;
      await controller.setCircuitBreaker(newBreaker);
      const breaker = await controller.circuitBreaker();
      expect(breaker).to.eq(newBreaker);
    })
  })

  describe('setDefaultExitFeeRecipient()', () => {
    setupTests({ setRecipient: false });

    it('Reverts if not called by governance', async () => {
      await verifyRejection(controller, 'setDefaultExitFeeRecipient', /ERR_NOT_GOVERNANCE/g, zeroAddress);
    })

    it('Reverts if address is zero', async () => {
      await verifyRejection(controller.connect(governance), 'setDefaultExitFeeRecipient', /ERR_NULL_ADDRESS/g, zeroAddress);
    })

    it('Sets default exit fee recipient', async () => {
      await controller.connect(governance).setDefaultExitFeeRecipient(feeRecipient);
      expect(await controller.defaultExitFeeRecipient()).to.eq(feeRecipient)
    })
  })

  describe('setExitFeeRecipient()', () => {
    setupTests({ setRecipient: true, init: true, pool: true, size: 5, ethValue: toWei(10) });

    it('Reverts if not called by governance', async () => {
      await verifyRejection(controller, 'setExitFeeRecipient', /ERR_NOT_GOVERNANCE/g, pool.address, feeRecipient);
    })

    it('Sets exit fee recipient', async () => {
      const recipient = `0x${'11'.repeat(20)}`;
      await controller.connect(governance).setExitFeeRecipient(pool.address, recipient);
      expect(await pool.getExitFeeRecipient()).to.eq(recipient)
    })
  })

  describe('setPublicSwap()', async () => {
    setupTests({ init: true, pool: true, size: 5, ethValue: toWei(10) });

    it('Reverts if not owner or circuit breaker', async () => {
      await verifyRejection(controller.connect(notOwner), 'setPublicSwap', /ERR_NOT_AUTHORIZED/g, pool.address, false);
    });

    it('Sets public swap to false as circuit breaker', async () => {
      await controller.connect(circuitBreaker).setPublicSwap(pool.address, false);
      expect(await pool.isPublicSwap()).to.be.false;
    })

    it('Sets public swap to true as owner', async () => {
      await controller.setPublicSwap(pool.address, true);
      expect(await pool.isPublicSwap()).to.be.true;
    })
  })

  describe('setDefaultSellerPremium()', async () => {
    setupTests();

    it('Reverts if premium == 0', async () => {
      await verifyRevert('setDefaultSellerPremium', /ERR_PREMIUM/g, 0);
    });

    it('Reverts if premium >= 20', async () => {
      await verifyRevert('setDefaultSellerPremium', /ERR_PREMIUM/g, 20);
    });

    it('Sets allowed premium', async () => {
      await controller.setDefaultSellerPremium(1);
      const premium = await controller.defaultSellerPremium();
      expect(premium).to.eq(1);
    });
  });

  describe('getInitialTokensAndBalances()', async () => {
    describe('Sqrt Fully Diluted Market Cap', async () => {
      setupTests({ category: true, useFullyDiluted: true, useSqrt: true });

      it('Returns the top n tokens and target balances weighted by mcap sqrt', async () => {
        const ethValue = toWei(1);
        const [expectedTokens, expectedBalances] = await getExpectedTokensAndBalances(5, ethValue, true, true);
        const [_tokens, balances] = await controller.getInitialTokensAndBalances(1, 5, ethValue);
        expect(_tokens).to.deep.eq(expectedTokens);
        for (let i = 0; i < 5; i++) {
          const diff = absDiff(balances[i], expectedBalances[i]);
          expect(diff).to.be.lte(1);
        }
      });

      it('Reverts if any token has a target balance below the minimum', async () => {
        const ethValue = toWei(1).div(1e12);
        await verifyRevert('getInitialTokensAndBalances', /ERR_MIN_BALANCE/g, 1, 2, ethValue);
      });
    })

    describe('Proportional Fully Diluted Market Cap', async () => {
      setupTests({ category: true, useFullyDiluted: true, useSqrt: false });

      it('Returns the top n tokens and target balances weighted by mcap sqrt', async () => {
        const ethValue = toWei(1);
        const [expectedTokens, expectedBalances] = await getExpectedTokensAndBalances(5, ethValue, false, true);
        const [_tokens, balances] = await controller.getInitialTokensAndBalances(1, 5, ethValue);
        expect(_tokens).to.deep.eq(expectedTokens);
        for (let i = 0; i < 5; i++) {
          const diff = absDiff(balances[i], expectedBalances[i]);
          expect(diff).to.be.lte(1);
        }
      });
    })

    describe('Sqrt Circulating Market Cap', async () => {
      setupTests({ category: true, useFullyDiluted: false, useSqrt: true });

      it('Returns the top n tokens and target balances weighted by mcap sqrt', async () => {
        const ethValue = toWei(1);
        const [expectedTokens, expectedBalances] = await getExpectedTokensAndBalances(5, ethValue, true, false);
        const [_tokens, balances] = await controller.getInitialTokensAndBalances(1, 5, ethValue);
        expect(_tokens).to.deep.eq(expectedTokens);
        for (let i = 0; i < 5; i++) {
          const diff = absDiff(balances[i], expectedBalances[i]) ;
          expect(diff).to.be.lte(1);
        }
      });
    })

    describe('Proportional Circulating Market Cap', async () => {
      setupTests({ category: true, useFullyDiluted: false, useSqrt: false });

      it('Returns the top n tokens and target balances weighted by mcap sqrt', async () => {
        await updatePrices(wrappedTokens);
        await fastForward(7200);
        const ethValue = toWei(1);
        const [expectedTokens, expectedBalances] = await getExpectedTokensAndBalances(5, ethValue, false, false);
        const [_tokens, balances] = await controller.getInitialTokensAndBalances(1, 5, ethValue);
        expect(_tokens).to.deep.eq(expectedTokens);
        for (let i = 0; i < 5; i++) {
          const diff = absDiff(balances[i], expectedBalances[i]);
          expect(diff).to.be.lte(1);
        }
      });
    })
  });

  describe('prepareIndexPool()', async () => {
    setupTests();

    it('Reverts if size > 10', async () => {
      await setupCategory();
      await verifyRevert('prepareIndexPool', /ERR_MAX_INDEX_SIZE/g, 1, 11, zero, 'a', 'b');
    });

    it('Reverts if size < 2', async () => {
      await verifyRevert('prepareIndexPool', /ERR_MIN_INDEX_SIZE/g, 1, 1, zero, 'a', 'b');
    });

    it('Reverts if initialWethValue >= 2^144', async () => {
      const ethValue = BigNumber.from(2).pow(144);
      await verifyRevert('prepareIndexPool', /ERR_MAX_UINT144/g, 1, 4, ethValue, 'a', 'b');
    });

    it('Succeeds with valid inputs', async () => {
      poolSize = 4;
      const { events } = await controller.prepareIndexPool(1, 4, toWei(10), 'Test Index Pool', 'TIP').then(tx => tx.wait());
      const { args: { pool: poolAddress, initializer: initializerAddress, listID, indexSize } } = events.filter(e => e.event == 'NewPoolInitializer')[0];
      pool = await ethers.getContractAt('SigmaIndexPoolV1', poolAddress);
      initializer = await ethers.getContractAt('SigmaPoolInitializerV1', initializerAddress);
      expect(listID.eq(1)).to.be.true;
      expect(indexSize.eq(4)).to.be.true;
    });

    it('Deploys the pool and initializer to the correct addresses', async () => {
      expect(pool.address).to.eq(await controller.computePoolAddress(1, 4));
      expect(initializer.address).to.eq(await controller.computeInitializerAddress(pool.address));
    });

    it('Reverts if the pool params are duplicates', async () => {
      await verifyRevert(
        'prepareIndexPool',
        /Create2: Failed on deploy/g,
        1, 4, toWei(10), 'Test Index Pool', 'TIP'
      );
    });

    it('Sets expected desired tokens and balances on pool initializer', async () => {
      const ethValue = toWei(10);
      const [expectedTokens, expectedBalances] = await getExpectedTokensAndBalances(4, ethValue);
      const desiredTokens = await initializer.getDesiredTokens();
      const desiredBalances = await initializer.getDesiredAmounts(desiredTokens);
      expect(desiredTokens).to.deep.eq(expectedTokens);
      for (let i = 0; i < desiredTokens.length; i++) {
        expect(+calcRelativeDiff(fromWei(expectedBalances[i]), fromWei(desiredBalances[i]))).to.be.lte(errorDelta);
      }
      await finishInitializer();
    });
  });

  describe('finishPreparedIndexPool()', async () => {
    setupTests();

    it('Reverts if caller is not initializer', async () => {
      await verifyRejection(ownerFaker, 'finishPreparedIndexPool', /ERR_NOT_PRE_DEPLOY_POOL/g);
    });

    it('Reverts if array lengths do not match', async () => {
      await setupCategory();
      const InitializerErrorTrigger = await ethers.getContractFactory('InitializerErrorTrigger');
      const initializerErrorTrigger = await InitializerErrorTrigger.deploy();
      await proxyManager.setImplementationAddressManyToOne(sha3('SigmaPoolInitializerV1.sol'), initializerErrorTrigger.address);
      const { poolAddress, initializerAddress } = await setupPool(2, 1);
      initializer = await ethers.getContractAt('InitializerErrorTrigger', initializerAddress);
      await verifyRejection(initializer, 'triggerArrLenError', /ERR_ARR_LEN/g);
    });

    it('Reverts if pool is already initialized', async () => {
      await updatePrices(wrappedTokens);
      await fastForward(7200);
      await addLiquidityAll();
      await verifyRejection(initializer, 'triggerDuplicateInit', /ERR_INITIALIZED/g);
      await proxyManager.setImplementationAddressManyToOne(sha3('SigmaPoolInitializerV1.sol'), initializerImplementation);
    });
  });

  describe('updateSellerPremium()', async () => {
    setupTests({ pool: true, init: true, size: 2, ethValue: 1 });

    it('Reverts if premium == 0', async () => {
      await verifyRevert('updateSellerPremium', /ERR_PREMIUM/g, tokenSeller.address, 0);
    });

    it('Reverts if premium >= 20', async () => {
      await verifyRevert('updateSellerPremium', /ERR_PREMIUM/g, tokenSeller.address, 20);
    });

    it('Sets premium within allowed range', async () => {
      await controller.updateSellerPremium(tokenSeller.address, 3);
      const premium = await tokenSeller.getPremiumPercent();
      expect(premium).to.eq(3);
    });
  });

  describe('setSwapFee()', async () => {
    setupTests({ pool: true, init: true, size: 2, ethValue: 1 });

    it('Sets swap fee on the pool', async () => {
      const fee = toWei('0.01');
      await controller.setSwapFee(pool.address, fee);
      const newFee = await pool.getSwapFee();
      expect(newFee.eq(fee)).to.be.true;
    });
  });

  describe('setController()', async () => {
    setupTests({ pool: true, init: true, size: 2, ethValue: 1 });

    it('Reverts if not called by governance', async () => {
      await verifyRejection(controller, 'setController', /ERR_NOT_GOVERNANCE/g, pool.address, `0x${'11'.repeat(20)}`);
    })

    it('Sets controller on the pool', async () => {
      await controller.connect(governance).setController(pool.address, `0x${'11'.repeat(20)}`);
      expect(await pool.getController()).to.eq(`0x${'11'.repeat(20)}`);
    })
  })

  describe('reweighPool()', async () => {
    describe('Sqrt Fully Diluted Market Cap', async () => {
      setupTests({ pool: true, init: true, size: 5, ethValue: 1, useFullyDiluted: true, useSqrt: true });
  
      it('Reverts if < 2 weeks have passed', async () => {
        await verifyRevert('reindexPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address);
      });
  
      it('Reweighs the pool and sets desired weights proportional to mcap sqrts', async () => {
        await prepareReweigh(true);
        const expectedWeights = await getExpectedDenorms(5, true, true);
        await controller.reweighPool(pool.address);
        for (let i = 0; i < 5; i++) {
          const desiredDenorm = (await pool.getTokenRecord(sortedWrappedTokens[i].address)).desiredDenorm;
          expect(desiredDenorm.eq(expectedWeights[i])).to.be.true;
        }
      });
  
      it('Sets reweighIndex', async () => {
        const {reweighIndex} = await controller.indexPoolMetadata(pool.address);
        expect(reweighIndex).to.eq(1)
      })

      it('Reverts if reweigh delay has not passed', async () => {
        await verifyRevert('reweighPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address)
      })
  
      it('Reverts if reweighIndex % 4 == 0', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await verifyRevert('reweighPool', /ERR_REWEIGH_INDEX/g, pool.address);
      });
    })

    describe('Proportional Fully Diluted Market Cap', async () => {
      setupTests({ category: true, pool: true, init: true, size: 5, ethValue: 1, useFullyDiluted: true, useSqrt: false });
  
      it('Reverts if < 2 weeks have passed', async () => {
        await verifyRevert('reindexPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address);
      });
  
      it('Reweighs the pool and sets desired weights proportional to mcap sqrts', async () => {
        await prepareReweigh(true);
        const expectedWeights = await getExpectedDenorms(5, true, false);
        await controller.reweighPool(pool.address);
        for (let i = 0; i < 5; i++) {
          const desiredDenorm = (await pool.getTokenRecord(sortedWrappedTokens[i].address)).desiredDenorm;
          expect(desiredDenorm.eq(expectedWeights[i])).to.be.true;
        }
      });
  
      it('Sets reweighIndex', async () => {
        const {reweighIndex} = await controller.indexPoolMetadata(pool.address);
        expect(reweighIndex).to.eq(1)
      })
  
      it('Reverts if reweighIndex % 4 == 0', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await verifyRevert('reweighPool', /ERR_REWEIGH_INDEX/g, pool.address);
      });
    })

    describe('Sqrt Circulating Market Cap', async () => {
      setupTests({ pool: true, init: true, category: true, size: 5, ethValue: 1, useFullyDiluted: false, useSqrt: true });
  
      it('Reverts if < 2 weeks have passed', async () => {
        await verifyRevert('reindexPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address);
      });
  
      it('Reweighs the pool and sets desired weights proportional to mcap sqrts', async () => {
        await prepareReweigh(true, false);
        const expectedWeights = await getExpectedDenorms(5, false, true);
        await controller.reweighPool(pool.address);
        for (let i = 0; i < 5; i++) {
          const desiredDenorm = (await pool.getTokenRecord(sortedWrappedTokens[i].address)).desiredDenorm;
          expect(desiredDenorm.eq(expectedWeights[i])).to.be.true;
        }
      });
  
      it('Sets reweighIndex', async () => {
        const {reweighIndex} = await controller.indexPoolMetadata(pool.address);
        expect(reweighIndex).to.eq(1)
      })
  
      it('Reverts if reweighIndex % 4 == 0', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await verifyRevert('reweighPool', /ERR_REWEIGH_INDEX/g, pool.address);
      });
    })

    describe('Proportional Circulating Market Cap', async () => {
      setupTests({ pool: true, init: true, category: true, size: 5, ethValue: 1, useFullyDiluted: false, useSqrt: false });
  
      it('Reverts if < 2 weeks have passed', async () => {
        await verifyRevert('reindexPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address);
      });
  
      it('Reweighs the pool and sets desired weights proportional to mcap sqrts', async () => {
        await prepareReweigh(true, false);
        const expectedWeights = await getExpectedDenorms(5, false, false);
        await controller.reweighPool(pool.address);
        for (let i = 0; i < 5; i++) {
          const desiredDenorm = (await pool.getTokenRecord(sortedWrappedTokens[i].address)).desiredDenorm;
          expect(desiredDenorm.eq(expectedWeights[i])).to.be.true;
        }
      });
  
      it('Sets reweighIndex', async () => {
        const {reweighIndex} = await controller.indexPoolMetadata(pool.address);
        expect(reweighIndex).to.eq(1)
      })
  
      it('Reverts if reweighIndex % 4 == 0', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await verifyRevert('reweighPool', /ERR_REWEIGH_INDEX/g, pool.address);
      });
    })
  });

  describe('reindexPool()', async () => {
    describe('Sqrt Fully Diluted Market Cap', async () => {
      setupTests({ pool: true, init: true, size: 5, ethValue: 10, useFullyDiluted: true, useSqrt: true });
  
      it('Reverts if < 2 weeks have passed', async () => {
        await verifyRevert('reindexPool', /ERR_POOL_REWEIGH_DELAY/g, pool.address);
      });
  
      it('Reverts if reweighIndex % 4 != 0', async () => {
        await prepareReweigh();
        await verifyRevert('reindexPool', /ERR_REWEIGH_INDEX/g, pool.address);
      });
  
      it('Reindexes the pool with correct minimum balances and desired weights', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh(true, true);
        const willBeIncluded = sortedWrappedTokens[5].address;
        await sortTokens(true);
        await controller.reindexPool(pool.address);
        const [token0, value0] = await pool.extrapolatePoolValueFromToken();
        const ethValue = liquidityManager.getTokenValue(token0, value0);
        const expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
        const actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
        expect(actualMinimumBalance.eq(expectedMinimumBalance)).to.be.true;
      });

      it('Sets expected target weights', async () => {
        const caps = await getMarketCaps(tokens, true);
        sortedWrappedTokens = [...wrappedTokens.map((t, i) => ({ ...t, marketCap: caps[i] }))]
        .sort((a, b) => {
          if (a.marketCap.lt(b.marketCap)) return 1;
          if (a.marketCap.gt(b.marketCap)) return -1;
          return 0;
        });
        const desiredDenorms = await getExpectedDenorms(5, true, true);
        for (let i = 0; i < 5; i++) {
          const token = sortedWrappedTokens[i];
          const record = await pool.getTokenRecord(token.address);
          expect(record.desiredDenorm.eq(desiredDenorms[i])).to.be.true;
        }
      })

      it('Increments reweighIndex', async () => {
        const { reweighIndex } = await controller.indexPoolMetadata(pool.address);
        expect(reweighIndex).to.eq(4)
      })
    })

    describe('Proportional Fully Diluted Market Cap', async () => {
      setupTests({ category: true, pool: true, init: true, size: 5, ethValue: 10, useFullyDiluted: true, useSqrt: false });
  
      it('Reindexes the pool with correct minimum balances and desired weights', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh(true);
        const willBeIncluded = sortedWrappedTokens[5].address;
        await sortTokens();
        await controller.reindexPool(pool.address);
        const [token0, value0] = await pool.extrapolatePoolValueFromToken();
        const ethValue = liquidityManager.getTokenValue(token0, value0);
        const expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
        const actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
        expect(actualMinimumBalance.eq(expectedMinimumBalance)).to.be.true;
      });

      it('Sets expected target weights', async () => {
        const caps = await getMarketCaps(tokens, true);
        sortedWrappedTokens = [...wrappedTokens.map((t, i) => ({ ...t, marketCap: caps[i] }))]
        .sort((a, b) => {
          if (a.marketCap.lt(b.marketCap)) return 1;
          if (a.marketCap.gt(b.marketCap)) return -1;
          return 0;
        });
        const desiredDenorms = await getExpectedDenorms(5, true, false);
        for (let i = 0; i < 5; i++) {
          const token = sortedWrappedTokens[i];
          const record = await pool.getTokenRecord(token.address);
          expect(record.desiredDenorm.eq(desiredDenorms[i])).to.be.true;
        }
      })
    })

    describe('Sqrt Circulating Market Cap', async () => {
      setupTests({ pool: true, init: true, size: 5, category: true, ethValue: 10, useFullyDiluted: false, useSqrt: true });

      it('Reindexes the pool with correct minimum balances and desired weights', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh(true, false);
        const willBeIncluded = sortedWrappedTokens[5].address;
        await sortTokens(false);
        await controller.reindexPool(pool.address);
        const [token0, value0] = await pool.extrapolatePoolValueFromToken();
        const ethValue = liquidityManager.getTokenValue(token0, value0);
        const expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
        const actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
        expect(actualMinimumBalance.eq(expectedMinimumBalance)).to.be.true;
      });

      it('Sets expected target weights', async () => {
        const desiredDenorms = await getExpectedDenorms(5, false, true);
        for (let i = 0; i < 5; i++) {
          const token = sortedWrappedTokens[i];
          const record = await pool.getTokenRecord(token.address);
          expect(record.desiredDenorm.eq(desiredDenorms[i])).to.be.true;
        }
      })
    })


    describe('Proportional Circulating Market Cap', async () => {
      setupTests({ category: true, pool: true, init: true, size: 5, ethValue: 10, useFullyDiluted: false, useSqrt: false });
  
      it('Reindexes the pool with correct minimum balances and desired weights', async () => {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh();
        await controller.reweighPool(pool.address);
        await prepareReweigh(true, false);
        const willBeIncluded = sortedWrappedTokens[5].address;
        await sortTokens(false);
        await controller.reindexPool(pool.address);
        const [token0, value0] = await pool.extrapolatePoolValueFromToken();
        const ethValue = liquidityManager.getTokenValue(token0, value0);
        const expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
        const actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
        expect(actualMinimumBalance.eq(expectedMinimumBalance)).to.be.true;
      });

      it('Sets expected target weights', async () => {
        const desiredDenorms = await getExpectedDenorms(5, false, false);
        for (let i = 0; i < 5; i++) {
          const token = sortedWrappedTokens[i];
          const record = await pool.getTokenRecord(token.address);
          expect(record.desiredDenorm.eq(desiredDenorms[i])).to.be.true;
        }
      })
    })
  });

  describe('forceReindexPool', async () => {
    setupTests({ pool: true, init: true, size: 5, ethValue: 10, useFullyDiluted: true, useSqrt: true });

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        controller.connect(notOwner),
        'forceReindexPool',
        /Ownable: caller is not the owner/g,
        pool.address
      )
    })
  
    it('Reindexes the pool with correct minimum balances and desired weights', async () => {
      await prepareReweigh();
      await controller.reweighPool(pool.address);
      await prepareReweigh(true, true);
      const willBeIncluded = sortedWrappedTokens[5].address;
      await sortTokens(true);
      await controller.forceReindexPool(pool.address);
      const [token0, value0] = await pool.extrapolatePoolValueFromToken();
      const ethValue = liquidityManager.getTokenValue(token0, value0);
      const expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
      const actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
      expect(actualMinimumBalance.eq(expectedMinimumBalance)).to.be.true;
    });

    it('Sets expected target weights', async () => {
      const caps = await getMarketCaps(tokens, true);
      sortedWrappedTokens = [...wrappedTokens.map((t, i) => ({ ...t, marketCap: caps[i] }))]
      .sort((a, b) => {
        if (a.marketCap.lt(b.marketCap)) return 1;
        if (a.marketCap.gt(b.marketCap)) return -1;
        return 0;
      });
      const desiredDenorms = await getExpectedDenorms(5, true, true);
      for (let i = 0; i < 5; i++) {
        const token = sortedWrappedTokens[i];
        const record = await pool.getTokenRecord(token.address);
        expect(record.desiredDenorm.eq(desiredDenorms[i])).to.be.true;
      }
    })

    it('Sets reweighIndex to next multiple of 4', async () => {
      expect((await controller.indexPoolMetadata(pool.address)).reweighIndex).to.eq(4)
      await controller.forceReindexPool(pool.address);
      expect((await controller.indexPoolMetadata(pool.address)).reweighIndex).to.eq(8)
    })
  })

  describe('updateMinimumBalance()', async () => {
    setupTests({ pool: true, init: true, size: 4, ethValue: 10 });

    it('Reverts if token is initialized', async () => {
      await verifyRevert('updateMinimumBalance', /ERR_TOKEN_READY/g, pool.address, sortedWrappedTokens[0].address);
    });

    it('Updates minimum balance based on extrapolated pool value', async () => {
      for (let i = 0; i < 3; i++) {
        await prepareReweigh();
        await controller.reweighPool(pool.address);
      }
      await prepareReweigh();
      const willBeIncluded = sortedWrappedTokens[4].address;
      await sortedWrappedTokens[4].token.getFreeTokens(from, liquidityManager.getEthValue(willBeIncluded, toWei(1e7)));
      await sortTokens();
      await controller.reindexPool(pool.address);
      let [token0, value0] = await pool.extrapolatePoolValueFromToken();
      let ethValue = liquidityManager.getTokenValue(token0, value0);
      let previousMinimum = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
      const _token0 = await ethers.getContractAt('MockERC20', token0);
      await _token0.getFreeTokens(pool.address, value0.div(50));
      await pool.gulp(token0);
      [token0, value0] = await pool.extrapolatePoolValueFromToken();
      ethValue = liquidityManager.getTokenValue(token0, value0);
      await controller.updateMinimumBalance(pool.address, willBeIncluded);
      let expectedMinimumBalance = liquidityManager.getEthValue(willBeIncluded, ethValue).div(100);
      let actualMinimumBalance = await pool.getMinimumBalance(willBeIncluded);
      expect(actualMinimumBalance.gt(previousMinimum)).to.be.true;
      expect(+calcRelativeDiff(fromWei(expectedMinimumBalance), fromWei(actualMinimumBalance))).to.be.lte(errorDelta);
    });
  });

  describe('delegateCompLikeTokenFromPool()', async () => {
    setupTests({ pool: true, init: true, size: 4, ethValue: 10 });

    it('Delegates a comp-like token in an index pool', async () => {
      const {token} = sortedWrappedTokens[0];
      const delegatee = sortedWrappedTokens[1].address;
      await controller.delegateCompLikeTokenFromPool(pool.address, token.address, delegatee);
      expect(await token.delegateeByAddress(pool.address)).to.eq(delegatee);
    });
  });
});
