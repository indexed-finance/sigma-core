// SPDX-License-Identifier: MIT
pragma solidity ^0.6.0;


interface ICirculatingMarketCapOracle {
  function getCirculatingMarketCap(address) external view returns (uint256);

  function getCirculatingMarketCaps(address[] calldata) external view returns (uint256[] memory);

  function updateCirculatingMarketCaps(address[] calldata) external;
}