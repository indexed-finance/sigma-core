const { expect } = require("chai");
const { categoriesFixture } = require("./fixtures/categories.fixture");
const { verifyRejection, zero, toWei, sha3, zeroAddress, fastForward, fromWei, oneE18, getTransactionTimestamp, DAY, HOUR } = require("./utils");
const { calcRelativeDiff } = require('./lib/calc_comparisons');

const errorDelta = 10 ** -8;

async function deploy(contractName, ...args) {
  const Factory = await ethers.getContractFactory(contractName);
  return Factory.deploy(...args);
}

describe('SortedTokenLists.sol', () => {
  let tokens, wrappedTokens, oracle;
  let addLiquidityAll, addLiquidity, deployTokenAndMarket;
  let circulatingCapOracle, liquidityManager;
  let tokenLists;
  let owner, notOwner;
  let verifyRevert;
  let tokenIndex = 0;
  let scoringStrategy;

  before(async () => {
    [owner, notOwner] = await ethers.getSigners();
  });

  const setupTests = () => {
    before(async () => {
      ({
        tokens: wrappedTokens,
        uniswapOracle: oracle,
        deployTokenAndMarket,
        addLiquidityAll,
        addLiquidity,
        liquidityManager
      } = await deployments.createFixture(categoriesFixture)());
      tokens = wrappedTokens.map(t => t.address);
      
      const deploy = async (name, ...args) => (await ethers.getContractFactory(name)).deploy(...args);
      const proxyManager = await deploy('DelegateCallProxyManager');
      const proxyAddress = await proxyManager.computeProxyAddressOneToOne(await owner.getAddress(), sha3('ScoredTokenLists.sol'));
      const categoriesImplementation = await deploy('ScoredTokenLists', oracle.address);
      await proxyManager.deployProxyOneToOne(sha3('ScoredTokenLists.sol'), categoriesImplementation.address);
      circulatingCapOracle = await deploy('MockCirculatingCapOracle');
      tokenLists = await ethers.getContractAt('ScoredTokenLists', proxyAddress);
      await tokenLists.initialize();
      verifyRevert = (...args) => verifyRejection(tokenLists, ...args);
    });
  }

  const makeTokenList = async (useFullyDilutedMarketCaps = true, minScore = 1, maxScore = toWei(100000000)) => {
    if (useFullyDilutedMarketCaps) {
      scoringStrategy = await deploy('ScoreByFDV', oracle.address);
    } else {
      scoringStrategy = await deploy('ScoreByCMC', circulatingCapOracle.address);
    }
    await tokenLists.createTokenList(`0x${'ff'.repeat(32)}`, scoringStrategy.address, minScore, maxScore);
  }

  const deployTestToken = async (liqA = 1, liqB = 1) => {
    const name = `Token${tokenIndex++}`;
    const symbol = `TK${tokenIndex++}`;
    const erc20 = await deployTokenAndMarket(name, symbol);
    await addLiquidity(erc20, toWei(liqA), toWei(liqB));
    return erc20;
  }

  const getFDVMarketCaps = (_tokens) => Promise.all(
    _tokens.map(
      async (token) => liquidityManager.getTokenValue(
        token,
        await (await ethers.getContractAt('IERC20', token)).totalSupply()
      )
    )
  );

  describe('Settings', async () => {
    setupTests();

    it('uniswapOracle', async () => {
      expect(await tokenLists.uniswapOracle()).to.eq(oracle.address);
    })
  })

  describe('getTokenListConfig()', async () => {
    setupTests();

    it('Reverts if token list does not exist', async () => {
      await verifyRevert('getTokenListConfig', /ERR_LIST_ID/g, 1);
    })

    it('Returns correct config', async () => {
      await makeTokenList(true, 1, 100);
      let [_scoringStrategy, minScore, maxScore] = await tokenLists.getTokenListConfig(1);
      expect(_scoringStrategy).to.eq(scoringStrategy.address);
      expect(minScore.eq(1)).to.be.true;
      expect(maxScore.eq(100)).to.be.true;
    })
  })

  describe('tokenListCount()', async () => {
    setupTests();

    it('Sets first token list ID to 1', async () => {
      let index = await tokenLists.tokenListCount();
      expect(index.eq(0)).to.be.true;
      await makeTokenList();
      index = await tokenLists.tokenListCount();
      expect(index.eq(1)).to.be.true;
    });
  });

  describe('updateTokenPrices()', async () => {
    setupTests();

    it('Reverts if token list does not exist', async () => {
      await verifyRevert('updateTokenPrices', /ERR_LIST_ID/g, 1);
    });

    it('Updates prices of tokens in list', async () => {
      await makeTokenList();
      await tokenLists.addTokens(1, tokens);
      await fastForward(3600);
      const {timestamp} = await ethers.provider.getBlock('latest');
      const priceKey = Math.floor(+timestamp / 3600);
      for (let token of tokens) {
        const hasPrice = await oracle.hasPriceObservationInWindow(token, priceKey);
        expect(hasPrice).to.be.false;
      }
      await addLiquidityAll();
      await tokenLists.updateTokenPrices(1);
      for (let token of tokens) {
        const hasPrice = await oracle.hasPriceObservationInWindow(token, priceKey);
        expect(hasPrice).to.be.true;
      }
    });
  })

  describe('isTokenInlist()', async () => {
    setupTests();

    it('Reverts if invalid list ID is given', async () => {
      await verifyRevert('isTokenInlist', /ERR_LIST_ID/g, 1, zeroAddress);
    });

    it('Returns false if token is not bound', async () => {
      await makeTokenList();
      await tokenLists.addTokens(1, tokens);
      expect(await tokenLists.isTokenInlist(1, zeroAddress)).to.be.false;
    });

    it('Returns true if token is bound', async () => {
      for (let token of tokens) {
        expect(await tokenLists.isTokenInlist(1, token)).to.be.true;
      }
    });

    it('Returns false if token is removed', async () => {
      for (let token of tokens) {
        await tokenLists.removeToken(1, token);
        expect(await tokenLists.isTokenInlist(1, token)).to.be.false;
      }
    });
  });

  describe('createTokenList()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        tokenLists.connect(notOwner),
        'createTokenList',
        /Ownable: caller is not the owner/g,
        `0x${'00'.repeat(32)}`,
        `0x${'ff'.repeat(20)}`,
        0,
        100
      );
    });

    it('Reverts if strategy is null address', async () => {
      await verifyRejection(
        tokenLists,
        'createTokenList',
        /ERR_NULL_ADDRESS/g,
        `0x${'00'.repeat(32)}`,
        `0x${'00'.repeat(20)}`,
        1,
        100
      );
    })

    it('Reverts if min cap is 0', async () => {
      await verifyRejection(
        tokenLists,
        'createTokenList',
        /ERR_NULL_MIN_CAP/g,
        `0x${'00'.repeat(32)}`,
        `0x${'ff'.repeat(20)}`,
        0,
        100
      );
    })

    it('Reverts if max cap < min cap', async () => {
      await verifyRejection(
        tokenLists,
        'createTokenList',
        /ERR_MAX_CAP/g,
        `0x${'00'.repeat(32)}`,
        `0x${'ff'.repeat(20)}`,
        100,
        99
      );
    })

    it('Allows owner to create a token list', async () => {
      const indexBefore = await tokenLists.tokenListCount();
      await tokenLists.createTokenList(
        `0x${'00'.repeat(32)}`,
        `0x${'ff'.repeat(20)}`,
        99,
        100
      );
      const indexAfter = await tokenLists.tokenListCount();
      expect(indexAfter.eq(indexBefore.add(1))).to.be.true;
    });
  });

  describe('addToken()', async () => {
    setupTests();
    let newTokens = [];

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        tokenLists.connect(notOwner),
        'addToken',
        /Ownable: caller is not the owner/g,
        0,
        zeroAddress
      );
    });

    it('Reverts if tokenListCount is 0', async () => {
      await verifyRevert('addToken', /ERR_LIST_ID/g, zero, zeroAddress);
    });

    it('Reverts if listID > tokenListCount', async () => {
      await makeTokenList();
      await verifyRevert('addToken', /ERR_LIST_ID/g, 2, zeroAddress);
    });

    it('Reverts if list is already at the maximum', async () => {
      for (let i = 0; i < 25; i++) {
        const token = await deployTestToken(1, 1);
        await tokenLists.addToken(1, token.address);
      }
      await verifyRevert('addToken', /ERR_MAX_LIST_TOKENS/g, 1, tokens[0]);
    });

    it('Reverts if token is already bound to same list', async () => {
      await makeTokenList();
      const token = await deployTestToken();
      newTokens.push(token.address);
      await tokenLists.addToken(2, token.address);
      await verifyRevert('addToken', /ERR_TOKEN_BOUND/g, 2, token.address);
    });
  });

  describe('removeToken()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        tokenLists.connect(notOwner),
        'removeToken',
        /Ownable: caller is not the owner/g,
        0,
        zeroAddress
      );
    });

    it('Reverts if tokenListCount is 0', async () => {
      await verifyRevert('removeToken', /ERR_LIST_ID/g, zero, zeroAddress);
    });

    it('Reverts if listID > tokenListCount', async () => {
      await makeTokenList();
      await verifyRevert('removeToken', /ERR_LIST_ID/g, 2, zeroAddress);
    });

    it('Reverts if list is empty', async () => {
      await tokenLists.createTokenList(`0x${'00'.repeat(32)}`, `0x${'ff'.repeat(20)}`, 1, 2);
      await verifyRevert('removeToken', /ERR_EMPTY_LIST/g, 2, zeroAddress);
    });

    it('Reverts if token not found', async () => {
      const token = await deployTestToken();
      await tokenLists.addToken(2, token.address);
      await verifyRevert('removeToken', /ERR_TOKEN_NOT_BOUND/g, 2, zeroAddress);
      await tokenLists.removeToken(2, token.address);
    });

    it('Swaps with last token in list', async () => {
      const tokenList = [];
      for (let i = 0; i < 25; i++) {
        const token = await deployTestToken();
        tokenList.push(token.address);
      }
      await tokenLists.addTokens(2, tokenList);
      await tokenLists.removeToken(2, tokenList[5]);
      tokenList[5] = tokenList.pop();
      const catTokens = await tokenLists.getTokenList(2);
      expect(catTokens).to.deep.eq(tokenList);
    });
  })

  describe('addTokens()', async () => {
    setupTests();

    it('Reverts if caller is not owner', async () => {
      await verifyRejection(
        tokenLists.connect(notOwner),
        'addTokens',
        /Ownable: caller is not the owner/g,
        0,
        [zeroAddress, zeroAddress],
      );
    });

    it('Reverts if tokenListCount is 0', async () => {
      await verifyRevert('addTokens', /ERR_LIST_ID/g, zero, [zeroAddress, zeroAddress]);
    });

    it('Reverts if listID > tokenListCount', async () => {
      await makeTokenList();
      await verifyRevert('addTokens', /ERR_LIST_ID/g, 2, [zeroAddress, zeroAddress]);
    });

    it('Reverts if token list would exceed maximum after adding the tokens', async () => {
      for (let i = 0; i < 24; i++) {
        const token = await deployTestToken();
        await tokenLists.addToken(1, token.address);
      }
      await verifyRevert('addTokens', /ERR_MAX_LIST_TOKENS/g, 1, [zeroAddress, zeroAddress]);
    });

    it('Reverts if any of the tokens are already bound', async () => {
      await makeTokenList();
      const token = await deployTestToken();
      await tokenLists.addToken(2, token.address);
      await verifyRevert('addTokens', /ERR_TOKEN_BOUND/g, 2, [token.address]);
    });
  });

  describe('sortAndFilterTokens()', async () => {
    setupTests();

    it('Reverts if the token list does not exist', async () => {
      await verifyRevert('sortAndFilterTokens', /ERR_LIST_ID/g, 1);
    });

    it('Sorts and filters the token list tokens', async () => {
      await addLiquidityAll();
      await fastForward(3600 * 48);
      const orderedTokens = [...wrappedTokens].sort((a, b) => {
        if (a.marketcap < b.marketcap) return 1;
        if (a.marketcap > b.marketcap) return -1;
        return 0;
      });
      const expectTokens = orderedTokens.map(t => t.address);
      const expectCaps = await getFDVMarketCaps(expectTokens);
      await makeTokenList(true, expectCaps[expectCaps.length - 1].add(1), expectCaps[0].sub(1));
      await tokenLists.addTokens(1, tokens);
      await tokenLists.sortAndFilterTokens(1);
      const removed = [];
      removed.push(expectTokens.pop());
      removed.push(expectTokens.shift());
      const realTokens = await tokenLists.getTokenList(1);
      expect(realTokens).to.deep.eq(expectTokens);
      expect(await tokenLists.isTokenInlist(1, removed[0])).to.be.false;
      expect(await tokenLists.isTokenInlist(1, removed[1])).to.be.false;
      for (let token of expectTokens) {
        expect(await tokenLists.isTokenInlist(1, token)).to.be.true;
      }
    })
  })

  describe('getTokenList()', async () => {
    setupTests();

    it('Reverts if tokenListCount is 0', async () => {
      await verifyRevert('getTokenList', /ERR_LIST_ID/g, zero);
    });

    it('Reverts if listID > tokenListCount', async () => {
      await makeTokenList();
      await verifyRevert('getTokenList', /ERR_LIST_ID/g, 2);
    });

    it('Returns the token list', async () => {
      await tokenLists.addTokens(1, tokens);
      expect(await tokenLists.getTokenList(1)).to.deep.eq(tokens);
    });
  });

  describe('getTokenScores()', async () => {
    describe('Using FD Market Caps', async () => {
      setupTests();
      it('Reverts if list does not exist', async () => {
        await verifyRevert('getTokenScores', /ERR_LIST_ID/g, zero, []);
      })

      it('Returns token market caps', async () => {
        await fastForward(3600 * 48);
        await addLiquidityAll();
        await fastForward(3600 * 48);
        const _tokens = wrappedTokens.map(t => t.address);
        const marketCaps = await getFDVMarketCaps(_tokens);
        await makeTokenList(true);
        await tokenLists.addTokens(1, _tokens);
        const scores = await tokenLists.getTokenScores(1, _tokens);
        for (let i = 0; i < scores.length; i++) {
          expect(marketCaps[i].eq(scores[i])).to.be.true;
        }
      })
    })
  })

  describe('getTopTokensAndScores()', async () => {
    describe('Using FD Market Caps', async () => {
      setupTests();

      it('Reverts if the token list does not exist', async () => {
        await verifyRevert('getTopTokensAndScores', /ERR_LIST_ID/g, 1, 1);
      });

      it('Reverts if size > list length', async () => {
        await makeTokenList();
        await tokenLists.addTokens(1, tokens);
        await fastForward(3600 * 48);
        await addLiquidityAll();
        await verifyRevert('getTopTokensAndScores', /ERR_LIST_SIZE/g, 1, 13);
      });

      it('Returns top n tokens in descending order of market cap', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const expectCaps = await getFDVMarketCaps(expectTokens);
        await makeTokenList(true, expectCaps[expectCaps.length - 1], expectCaps[0]);
        await tokenLists.addTokens(2, tokens);
        const [topTokens, topMarketCaps] = await tokenLists.getTopTokensAndScores(2, 10);
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
        const expectCaps = await getFDVMarketCaps(expectTokens);
        expectTokens.shift();
        expectCaps.shift();
        await makeTokenList(true, expectCaps[expectCaps.length - 1].sub(1), expectCaps[0].add(1));
        await tokenLists.addTokens(3, tokens);
        const [topTokens, topMarketCaps] = await tokenLists.getTopTokensAndScores(3, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i])).to.be.true;
        }
      })
    })

    describe('Using Circulating Market Caps', async () => {
      setupTests();

      it('Reverts if the token list does not exist', async () => {
        await verifyRevert('getTopTokensAndScores', /ERR_LIST_ID/g, 1, 1);
      });

      it('Reverts if size > length of list', async () => {
        await makeTokenList(false);
        await tokenLists.addTokens(1, tokens);
        await fastForward(3600 * 48);
        await verifyRevert('getTopTokensAndScores', /ERR_LIST_SIZE/g, 1, 13);
      });

      it('Returns top n tokens in descending order of market cap', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const fdvCaps = await getFDVMarketCaps(expectTokens);
        await circulatingCapOracle.setCirculatingMarketCaps(
          expectTokens,
          fdvCaps.map(c => c.div(2))
        );
        await makeTokenList(false, fdvCaps[fdvCaps.length - 1], fdvCaps[0]);
        await tokenLists.addTokens(2, tokens);
        const [topTokens, topMarketCaps] = await tokenLists.getTopTokensAndScores(2, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(fdvCaps[i].div(2))).to.be.true;
        }
      });
  
      it('Filters out tokens outside min/max market cap bounds', async () => {
        const orderedTokens = [...wrappedTokens].sort((a, b) => {
          if (a.marketcap < b.marketcap) return 1;
          if (a.marketcap > b.marketcap) return -1;
          return 0;
        });
        const expectTokens = orderedTokens.map(t => t.address);
        const expectCaps = await getFDVMarketCaps(expectTokens);
        await circulatingCapOracle.setCirculatingMarketCaps(
          expectTokens,
          expectCaps.map(c => c.div(2))
        );
        expectTokens.shift();
        expectCaps.shift();
        await makeTokenList(false, expectCaps[expectCaps.length - 1].div(2).sub(1), expectCaps[0].div(2).add(1));
        await tokenLists.addTokens(3, tokens);
        const [topTokens, topMarketCaps] = await tokenLists.getTopTokensAndScores(3, 10);
        for (let i = 0; i < 10; i++) {
          expect(topTokens[i]).to.eq(expectTokens[i]);
          expect(topMarketCaps[i].eq(expectCaps[i].div(2))).to.be.true;
        }
      })
    })
  });
});