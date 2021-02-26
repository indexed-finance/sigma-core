// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;


contract MockCirculatingCapOracle {
  mapping(address => uint256) public getCirculatingMarketCap;

  function getCirculatingMarketCaps(address[] calldata tokens) external view returns (uint256[] memory caps) {
    caps = new uint256[](tokens.length);
    for (uint256 i = 0; i < tokens.length; i++) {
      caps[i] = getCirculatingMarketCap[tokens[i]];
    }
  }

  function updateCirculatingMarketCaps(address[] calldata tokens) external {
    for (uint256 i = 0; i < tokens.length; i++) {
      getCirculatingMarketCap[tokens[i]]++;
    }
  }

  function setCirculatingMarketCaps(address[] calldata tokens, uint256[] calldata marketCaps) external {
    for (uint256 i = 0; i < tokens.length; i++) {
      getCirculatingMarketCap[tokens[i]] = marketCaps[i];
    }
  }
}