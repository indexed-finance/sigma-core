// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;


library TokenSortLibrary {
  /**
   * @dev Given a list of tokens and their market caps, sort by market caps
   * in descending order, and filter out the tokens with market caps that
   * are not within the min/max bounds provided.
   */
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

  /**
   * @dev Given a list of tokens and their market caps, sort by market caps
   * in descending order, and filter out the tokens with market caps that
   * are not within the min/max bounds provided.
   * This function also returns the list of removed tokens.
   */
  function sortAndFilterReturnRemoved(
    address[] memory tokens,
    uint256[] memory marketCaps,
    uint256 minimumCap,
    uint256 maximumCap
  ) internal pure returns (address[] memory removed) {
    uint256 removedIndex = 0;
    uint256 len = tokens.length;
    removed = new address[](len);
    for (uint256 i = 0; i < len; i++) {
      uint256 cap = marketCaps[i];
      address token = tokens[i];
      if (cap > maximumCap || cap < minimumCap) {
        removed[removedIndex++] = token;
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
        mstore(removed, removedIndex)
      }
    }
  }
}