// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

import "@openzeppelin/contracts/access/Ownable.sol";

import "../interfaces/IScoringStrategy.sol";
import "../interfaces/ICirculatingMarketCapOracle.sol";


contract ScoreByCMC is Ownable, IScoringStrategy {
  // Chainlink or other circulating market cap oracle
  address public circulatingMarketCapOracle;

  constructor(address circulatingMarketCapOracle_) public Ownable() {
    circulatingMarketCapOracle = circulatingMarketCapOracle_;
  }

  function getTokenScores(address[] calldata tokens)
    external
    view
    override
    returns (uint256[] memory scores)
  {
    scores = ICirculatingMarketCapOracle(circulatingMarketCapOracle).getCirculatingMarketCaps(tokens);
  }

  /**
   * @dev Update the address of the circulating market cap oracle.
   */
  function setCirculatingMarketCapOracle(address circulatingMarketCapOracle_) external onlyOwner {
    circulatingMarketCapOracle = circulatingMarketCapOracle_;
  }
}