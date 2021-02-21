const { expect } = require("chai");
const { categoriesFixture } = require("./fixtures/categories.fixture");
const { verifyRejection, zero, toWei, sha3, zeroAddress, fastForward, fromWei, oneE18, getTransactionTimestamp, DAY, HOUR } = require("./utils");
const { calcRelativeDiff } = require('./lib/calc_comparisons');
const { BigNumber } = require("ethers");

const errorDelta = 10 ** -8;

describe('MarketCapSortedTokenCategories.sol', () => {
  let updatePrices, tokens, wrappedTokens, oracle;
  let addLiquidityAll, addLiquidity, deployTokenAndMarket;
  let circulatingCapOracle;
  let categories;
  let owner, notOwner;
  let verifyRevert;
  let tokenIndex = 0;

  before(async () => {
    [owner, notOwner] = await ethers.getSigners();
  });

  const setupTests = () => {
    before(async () => {
      ({
        updatePrices,
        tokens: wrappedTokens,
        uniswapOracle: oracle,
        deployTokenAndMarket,
        addLiquidityAll,
        addLiquidity
      } = await deployments.createFixture(categoriesFixture)());
      tokens = wrappedTokens.map(t => t.address);
      
      const deploy = async (name, ...args) => (await ethers.getContractFactory(name)).deploy(...args);
      const proxyManager = await deploy('DelegateCallProxyManager');
      const proxyAddress = await proxyManager.computeProxyAddressOneToOne(await owner.getAddress(), sha3('MarketCapSortedTokenCategories.sol'));
      const categoriesImplementation = await deploy('MarketCapSortedTokenCategories', oracle.address);
      await proxyManager.deployProxyOneToOne(sha3('MarketCapSortedTokenCategories.sol'), categoriesImplementation.address);
      circulatingCapOracle = await deploy('MockCirculatingCapOracle');
      categories = await ethers.getContractAt('MarketCapSortedTokenCategories', proxyAddress);
      await categories.initialize(circulatingCapOracle.address);
      verifyRevert = (...args) => verifyRejection(categories, ...args);
    });
  }

  const makeCategory = (useFullyDilutedMarketCaps = true, minCap = 1, maxCap = toWei(100000000)) =>
    categories.createCategory(`0x${'ff'.repeat(32)}`, useFullyDilutedMarketCaps, minCap, maxCap);

  const deployTestToken = async (liqA = 1, liqB = 1) => {
    const name = `Token${tokenIndex++}`;
    const symbol = `TK${tokenIndex++}`;
    const erc20 = await deployTokenAndMarket(name, symbol);
    await addLiquidity(erc20, toWei(liqA), toWei(liqB));
    return erc20;
  }

  describe('Settings', async () => {
    setupTests();

    it('uniswapOracle', async () => {
      expect(await categories.uniswapOracle()).to.eq(oracle.address);
    })

    it('circulatingMarketCapOracle', async () => {
      expect(await categories.circulatingMarketCapOracle()).to.eq(circulatingCapOracle.address);
    })
  })

  describe('setCirculatingMarketCapOracle()', async () => {
    setupTests();

    it('Reverts if not called by owner', async () => {
      await verifyRejection(
        categories.connect(notOwner),
        'setCirculatingMarketCapOracle',
        /Ownable: caller is not the owner/g,
        zeroAddress
      );
    });

    it('Sets new oracle', async () => {
      await categories.setCirculatingMarketCapOracle(zeroAddress);
      expect(await categories.circulatingMarketCapOracle()).to.eq(zeroAddress);
    })
  })

  describe('getCategoryConfig()', async () => {
    setupTests();

    it('Reverts if category does not exist', async () => {
      await verifyRevert('getCategoryConfig', /ERR_CATEGORY_ID/g, 1);
    })

    it('Returns correct config', async () => {
      await makeCategory(true, 1, 100);
      let [useFullyDilutedMarketCaps, minCap, maxCap] = await categories.getCategoryConfig(1);
      expect(useFullyDilutedMarketCaps).to.be.true;
      expect(minCap.eq(1)).to.be.true;
      expect(maxCap.eq(100)).to.be.true;
      await makeCategory(false, 1, 100);
      [useFullyDilutedMarketCaps, minCap, maxCap] = await categories.getCategoryConfig(2);
      expect(useFullyDilutedMarketCaps).to.be.false;
      expect(minCap.eq(1)).to.be.true;
      expect(maxCap.eq(100)).to.be.true;
    })
  })

  describe('categoryIndex()', async () => {
    setupTests();

    it('Sets first category ID to 1', async () => {
      let index = await categories.categoryIndex();
      expect(index.eq(0)).to.be.true;
      await makeCategory();
      index = await categories.categoryIndex();
      expect(index.eq(1)).to.be.true;
      expect(await categories.hasCategory(1)).to.be.true;
    });
  });

  describe('updateCategoryPrices()', async () => {
    setupTests();

    it('Reverts if category does not exist', async () => {
      await verifyRevert('updateCategoryPrices', /ERR_CATEGORY_ID/g, 1);
    });

    it('Updates prices of tokens in category', async () => {
      await makeCategory();
      await categories.addTokens(1, tokens);
      await fastForward(3600);
      const {timestamp} = await ethers.provider.getBlock('latest');
      const priceKey = Math.floor(+timestamp / 3600);
      for (let token of tokens) {
        const hasPrice = await oracle.hasPriceObservationInWindow(token, priceKey);
        expect(hasPrice).to.be.false;
      }
      await addLiquidityAll();
      await categories.updateCategoryPrices(1);
      for (let token of tokens) {
        const hasPrice = await oracle.hasPriceObservationInWindow(token, priceKey);
        expect(hasPrice).to.be.true;
      }
    });
  })

  describe('updateCategoryMarketCaps()', async () => {
    setupTests();

    it('Reverts if category does not exist', async () => {
      await verifyRevert('updateCategoryMarketCaps', /ERR_CATEGORY_ID/g, 1);
    });

    it('Reverts if category does not use circulating cap', async () => {
      await makeCategory(true);
      await verifyRevert('updateCategoryMarketCaps', /ERR_NOT_CIRC_CAT/g, 1);
    });

    it('Updates prices of tokens in category', async () => {
      await makeCategory(false);
      await categories.addTokens(2, tokens);
      await categories.updateCategoryMarketCaps(2);
      const marketCaps = await circulatingCapOracle.getCirculatingMarketCaps(tokens);
      for (let i = 0; i < marketCaps.length; i++) {
        expect(marketCaps[i].eq(1)).to.be.true;
      }
    });
  })

  describe('hasCategory()', async () => {
    setupTests();

    it('Returns false if category does not exist', async () => {
      expect(await categories.hasCategory(0)).to.be.false;
      expect(await categories.hasCategory(1)).to.be.false;
    });

    it('Returns true if category exists', async () => {
      await makeCategory();
      expect(await categories.hasCategory(1)).to.be.true;
    });
  });

  describe('isTokenInCategory()', async () => {
    setupTests();

    it('Reverts if invalid category ID is given', async () => {
      await verifyRevert('isTokenInCategory', /ERR_CATEGORY_ID/g, 1, zeroAddress);
    });

    it('Returns false if token is not bound', async () => {
      await makeCategory();
      await categories.addTokens(1, tokens);
      expect(await categories.isTokenInCategory(1, zeroAddress)).to.be.false;
    });

    it('Returns true if token is bound', async () => {
      for (let token of tokens) {
        expect(await categories.isTokenInCategory(1, token)).to.be.true;
      }
    });

    it('Returns false if token is removed', async () => {
      for (let token of tokens) {
        await categories.removeToken(1, token);
        expect(await categories.isTokenInCategory(1, token)).to.be.false;
      }
    });
  });

  describe('createCategory()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        categories.connect(notOwner),
        'createCategory',
        /Ownable: caller is not the owner/g,
        `0x${'00'.repeat(32)}`,
        true,
        0,
        100
      );
    });

    it('Reverts if min cap is 0', async () => {
      await verifyRejection(
        categories,
        'createCategory',
        /ERR_NULL_MIN_CAP/g,
        `0x${'00'.repeat(32)}`,
        true,
        0,
        100
      );
    })

    it('Reverts if max cap < min cap', async () => {
      await verifyRejection(
        categories,
        'createCategory',
        /ERR_MAX_CAP/g,
        `0x${'00'.repeat(32)}`,
        true,
        100,
        99
      );
    })

    it('Allows owner to create a category', async () => {
      const indexBefore = await categories.categoryIndex();
      await categories.createCategory(
        `0x${'00'.repeat(32)}`,
        true,
        99,
        100
      );
      const indexAfter = await categories.categoryIndex();
      expect(indexAfter.eq(indexBefore.add(1))).to.be.true;
    });
  });

  describe('addToken()', async () => {
    setupTests();
    let newTokens = [];

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        categories.connect(notOwner),
        'addToken',
        /Ownable: caller is not the owner/g,
        0,
        zeroAddress
      );
    });

    it('Reverts if categoryIndex is 0', async () => {
      await verifyRevert('addToken', /ERR_CATEGORY_ID/g, zero, zeroAddress);
    });

    it('Reverts if categoryID > categoryIndex', async () => {
      await makeCategory();
      await verifyRevert('addToken', /ERR_CATEGORY_ID/g, 2, zeroAddress);
    });

    it('Reverts if category is already at the maximum', async () => {
      for (let i = 0; i < 25; i++) {
        const token = await deployTestToken(1, 1);
        await categories.addToken(1, token.address);
      }
      await verifyRevert('addToken', /ERR_MAX_CATEGORY_TOKENS/g, 1, tokens[0]);
    });

    it('Reverts if token is already bound to same category', async () => {
      await makeCategory();
      const token = await deployTestToken();
      newTokens.push(token.address);
      await categories.addToken(2, token.address);
      await verifyRevert('addToken', /ERR_TOKEN_BOUND/g, 2, token.address);
    });
  });

  describe('removeToken()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        categories.connect(notOwner),
        'removeToken',
        /Ownable: caller is not the owner/g,
        0,
        zeroAddress
      );
    });

    it('Reverts if categoryIndex is 0', async () => {
      await verifyRevert('removeToken', /ERR_CATEGORY_ID/g, zero, zeroAddress);
    });

    it('Reverts if categoryID > categoryIndex', async () => {
      await makeCategory();
      await verifyRevert('removeToken', /ERR_CATEGORY_ID/g, 2, zeroAddress);
    });

    it('Reverts if category is empty', async () => {
      await categories.createCategory(`0x${'00'.repeat(32)}`, true, 1, 2);
      await verifyRevert('removeToken', /ERR_EMPTY_CATEGORY/g, 2, zeroAddress);
    });

    it('Reverts if token not found', async () => {
      const token = await deployTestToken();
      await categories.addToken(2, token.address);
      await verifyRevert('removeToken', /ERR_TOKEN_NOT_BOUND/g, 2, zeroAddress);
      await categories.removeToken(2, token.address);
    });

    it('Swaps with last token in list', async () => {
      const tokenList = [];
      for (let i = 0; i < 25; i++) {
        const token = await deployTestToken();
        tokenList.push(token.address);
      }
      await categories.addTokens(2, tokenList);
      await categories.removeToken(2, tokenList[5]);
      tokenList[5] = tokenList.pop();
      const catTokens = await categories.getCategoryTokens(2);
      expect(catTokens).to.deep.eq(tokenList);
    });
  })

  describe('addTokens()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        categories.connect(notOwner),
        'addTokens',
        /Ownable: caller is not the owner/g,
        0,
        [zeroAddress, zeroAddress],
      );
    });

    it('Reverts if categoryIndex is 0', async () => {
      await verifyRevert('addTokens', /ERR_CATEGORY_ID/g, zero, [zeroAddress, zeroAddress]);
    });

    it('Reverts if categoryID > categoryIndex', async () => {
      await makeCategory();
      await verifyRevert('addTokens', /ERR_CATEGORY_ID/g, 2, [zeroAddress, zeroAddress]);
    });

    it('Reverts if category would exceed maximum after adding the tokens', async () => {
      for (let i = 0; i < 24; i++) {
        const token = await deployTestToken();
        await categories.addToken(1, token.address);
      }
      await verifyRevert('addTokens', /ERR_MAX_CATEGORY_TOKENS/g, 1, [zeroAddress, zeroAddress]);
    });

    it('Reverts if any of the tokens are already bound', async () => {
      await makeCategory();
      const token = await deployTestToken();
      await categories.addToken(2, token.address);
      await verifyRevert('addTokens', /ERR_TOKEN_BOUND/g, 2, [token.address]);
    });
  });

  describe('sortAndFilterTokens', async () => {
    describe('Using FD Market Caps', async () => {
      setupTests();

      it('Reverts if the category does not exist', async () => {
        await verifyRevert('sortAndFilterTokens', /ERR_CATEGORY_ID/g, 1);
      });

      it('Sorts and filters the category tokens', async () => {
        await addLiquidityAll();
        await fastForward(3600 * 48);
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const expectCaps = await categories.getFullyDilutedMarketCaps(expectTokens);
        await makeCategory(true, expectCaps[expectCaps.length - 1].add(1), expectCaps[0].sub(1));
        await categories.addTokens(1, tokens);
        await categories.sortAndFilterTokens(1);
        expectTokens.pop();
        expectTokens.shift();
        const realTokens = await categories.getCategoryTokens(1);
        expect(realTokens).to.deep.eq(expectTokens);
      })
    })
  })

  describe('getCategoryTokens()', async () => {
    setupTests();

    it('Reverts if categoryIndex is 0', async () => {
      await verifyRevert('getCategoryTokens', /ERR_CATEGORY_ID/g, zero);
    });

    it('Reverts if categoryID > categoryIndex', async () => {
      await makeCategory();
      await verifyRevert('getCategoryTokens', /ERR_CATEGORY_ID/g, 2);
    });

    it('Returns the category tokens', async () => {
      await categories.addTokens(1, tokens);
      expect(await categories.getCategoryTokens(1)).to.deep.eq(tokens);
    });
  });

  describe('getFullyDilutedMarketCaps()', async () => {
    setupTests();

    it('Reverts if the oracle does not have price observations in the TWAP range', async () => {
      await verifyRevert('getFullyDilutedMarketCaps', /IndexedUniswapV2Oracle::_getTokenPrice: No price found in provided range\./g, tokens);
    });

    it('Returns correct token market caps', async () => {
      await fastForward(3600 * 48);
      await addLiquidityAll();
      await makeCategory();
      await categories.addTokens(1, tokens);
      const actual = await categories.getFullyDilutedMarketCaps(tokens);
      const expected = await Promise.all(wrappedTokens.map(async ({ token, price }) => {
        const _price = toWei(price);
        return (await token.totalSupply()).mul(_price).div(oneE18);
      }));
      for (let i = 0; i < tokens.length; i++) {
        expect(+calcRelativeDiff(fromWei(expected[i]), fromWei(actual[i]))).to.be.lte(errorDelta);
      }
    });
  });

  describe('getTopCategoryTokensAndMarketCaps()', async () => {
    describe('Using FD Market Caps', async () => {
      setupTests();

      it('Reverts if the category does not exist', async () => {
        await verifyRevert('getTopCategoryTokensAndMarketCaps', /ERR_CATEGORY_ID/g, 1, 1);
      });

      it('Reverts if size > number of category tokens', async () => {
        await makeCategory();
        await categories.addTokens(1, tokens);
        await fastForward(3600 * 48);
        await addLiquidityAll();
        await verifyRevert('getTopCategoryTokensAndMarketCaps', /ERR_CATEGORY_SIZE/g, 1, 13);
      });

      it('Returns top n tokens in descending order of market cap', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const expectCaps = await categories.getFullyDilutedMarketCaps(orderedTokens.map(t => t.address));
        await makeCategory(true, expectCaps[expectCaps.length - 1], expectCaps[0]);
        await categories.addTokens(2, tokens);
        const [topTokens, topMarketCaps] = await categories.getTopCategoryTokensAndMarketCaps(2, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i])).to.be.true;
        }
      });
  
      it('Filters out tokens outside min/max market cap bounds', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        let expectCaps = [...(await categories.getFullyDilutedMarketCaps(expectTokens))];
        expectTokens.shift();
        expectCaps.shift();
        await makeCategory(true, expectCaps[expectCaps.length - 1].sub(1), expectCaps[0].add(1));
        await categories.addTokens(3, tokens);
        const [topTokens, topMarketCaps] = await categories.getTopCategoryTokensAndMarketCaps(3, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i])).to.be.true;
        }
      })
    })

    describe('Using Circulating Market Caps', async () => {
      setupTests();

      it('Reverts if the category does not exist', async () => {
        await verifyRevert('getTopCategoryTokensAndMarketCaps', /ERR_CATEGORY_ID/g, 1, 1);
      });

      it('Reverts if size > number of category tokens', async () => {
        await makeCategory(false);
        await categories.addTokens(1, tokens);
        await fastForward(3600 * 48);
        await verifyRevert('getTopCategoryTokensAndMarketCaps', /ERR_CATEGORY_SIZE/g, 1, 13);
      });

      it('Returns top n tokens in descending order of market cap', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const expectCaps = await categories.getFullyDilutedMarketCaps(orderedTokens.map(t => t.address));
        await circulatingCapOracle.setCirculatingMarketCaps(
          expectTokens,
          expectCaps.map(c => c.div(2))
        );
        await makeCategory(false, expectCaps[expectCaps.length - 1], expectCaps[0]);
        await categories.addTokens(2, tokens);
        const [topTokens, topMarketCaps] = await categories.getTopCategoryTokensAndMarketCaps(2, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i].div(2))).to.be.true;
        }
      });
  
      it('Filters out tokens outside min/max market cap bounds', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        let expectCaps = [...(await categories.getFullyDilutedMarketCaps(expectTokens))];
        await circulatingCapOracle.setCirculatingMarketCaps(
          expectTokens,
          expectCaps.map(c => c.div(2))
        );
        expectTokens.shift();
        expectCaps.shift();
        await makeCategory(false, expectCaps[expectCaps.length - 1].div(2).sub(1), expectCaps[0].div(2).add(1));
        await categories.addTokens(3, tokens);
        const [topTokens, topMarketCaps] = await categories.getTopCategoryTokensAndMarketCaps(3, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i].div(2))).to.be.true;
        }
      })
    })
  });
});