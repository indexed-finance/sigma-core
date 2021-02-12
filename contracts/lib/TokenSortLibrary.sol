// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;


library TokenSortLibrary {
  function sortAndFilter(
    address[] memory tokens,
    uint256[] memory marketCaps,
    uint256 minimumCap,
    uint256 maximumCap
  ) internal pure {
    uint256 len = tokens.length;
    for (uint256 i = 0; i < len; i++) {
      uint256 cap = marketCaps[i];
      address token = tokens[i];
      if (cap > maximumCap || cap < minimumCap) {
        token = tokens[--len];
        cap = marketCaps[len];
        marketCaps[i] = cap;
        tokens[i] = token;
        i--;
        continue;
      }
      uint256 j = i - 1;
      while (int(j) >= 0 && marketCaps[j] < cap) {
        marketCaps[j + 1] = marketCaps[j];
        tokens[j + 1] = tokens[j];
        j--;
      }
      marketCaps[j + 1] = cap;
      tokens[j + 1] = token;
    }
    if (len != tokens.length) {
      assembly {
        mstore(tokens, len)
        mstore(marketCaps, len)
      }
    }
  }
}