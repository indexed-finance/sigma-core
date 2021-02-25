// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IScoringStrategy.sol";


contract ScoreByFDV is Ownable, IScoringStrategy {
/* ==========  Constants  ========== */

  // TWAP parameters for capturing long-term price trends
  uint32 public constant LONG_TWAP_MIN_TIME_ELAPSED = 1 days;
  uint32 public constant LONG_TWAP_MAX_TIME_ELAPSED = 1.5 weeks;

  // Uniswap TWAP oracle
  IIndexedUniswapV2Oracle public immutable uniswapOracle;

  constructor(address uniswapOracle_) public Ownable() {
    uniswapOracle = IIndexedUniswapV2Oracle(uniswapOracle_);
  }

  /**
   * @dev Compute the average fully-diluted market caps in weth for a set of tokens.
   * Queries the average amounts of ether that the total supplies are worth
   * using the recent moving average prices.
   */
  function getTokenScores(address[] calldata tokens)
    external
    view
    override
    returns (uint256[] memory scores)
  {
    uint256 len = tokens.length;
    uint256[] memory totalSupplies = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      totalSupplies[i] = IERC20(tokens[i]).totalSupply();
    }
    scores = uniswapOracle.computeAverageEthForTokens(
      tokens,
      totalSupplies,
      LONG_TWAP_MIN_TIME_ELAPSED,
      LONG_TWAP_MAX_TIME_ELAPSED
    );
  }
}


interface IERC20 {
  function totalSupply() external view returns (uint256);
}


interface IIndexedUniswapV2Oracle {
  function computeAverageEthForTokens(
    address[] calldata tokens,
    uint256[] calldata tokenAmounts,
    uint256 minTimeElapsed,
    uint256 maxTimeElapsed
  ) external view returns (uint256[] memory);
}