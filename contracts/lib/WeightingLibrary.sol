// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

/* ========== External Libraries ========== */
import "@indexed-finance/uniswap-v2-oracle/contracts/lib/FixedPoint.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";


library WeightingLibrary {
  using SafeMath for uint256;
  using FixedPoint for FixedPoint.uq112x112;
  using FixedPoint for FixedPoint.uq144x112;

  // Default total weight for a pool.
  uint256 internal constant WEIGHT_MULTIPLIER = 25e18;

  function weightProportionally(uint256[] memory values)
    internal
    pure
    returns (FixedPoint.uq112x112[] memory weights)
  {
    uint256 sum;
    uint256 len = values.length;
    weights = new FixedPoint.uq112x112[](len);
    for (uint256 i = 0; i < len; i++) {
      sum = sum.add(values[i]);
    }
    uint112 safeSum = safeUint112(sum);
    for (uint256 i = 0; i < len; i++) {
      weights[i] = FixedPoint.fraction(safeUint112(values[i]), safeSum);
    }
  }

  function weightBySqrt(uint256[] memory values)
    internal
    pure
    returns (FixedPoint.uq112x112[] memory weights)
  {
    uint256 len = values.length;
    uint256[] memory sqrts = new uint256[](len);
    uint256 sum;
    for (uint256 i = 0; i < len; i++) {
      uint sqrt_ = sqrt(values[i]);
      sqrts[i] = sqrt_;
      // Will not overflow - would need 72057594037927940 tokens in the index
      // before the sum of sqrts of a uint112 could overflow
      sum = sum += sqrt_;
    }
    // Initialize the array of weights
    weights = new FixedPoint.uq112x112[](len);
    uint112 safeSum = safeUint112(sum);
    for (uint256 i = 0; i < len; i++) {
      weights[i] = FixedPoint.fraction(safeUint112(sqrts[i]), safeSum);
    }
  }

  function safeUint112(uint256 x) internal pure returns (uint112 y) {
    y = uint112(x);
    require(y == x, "ERR_MAX_UINT112");
  }

  function sqrt(uint y) internal pure returns (uint z) {
    if (y > 3) {
      z = y;
      uint x = (y + 1) / 2;
      while (x < z) {
        z = x;
        x = (y / x + x) / 2;
      }
    } else if (y != 0) {
      z = 1;
    }
  }

  /**
   * @dev Converts a fixed point fraction to a denormalized weight.
   * Multiply the fraction by the max weight and decode to an unsigned integer.
   */
  function denormalizeFractionalWeights(FixedPoint.uq112x112[] memory fractionalWeights)
    internal
    pure
    returns (uint96[] memory denormalizedWeights)
  {
    uint256 len = fractionalWeights.length;
    denormalizedWeights = new uint96[](len);
    for (uint256 i = 0; i < len; i++) {
      denormalizedWeights[i] = uint96(fractionalWeights[i].mul(WEIGHT_MULTIPLIER).decode144());
    }
  }
}