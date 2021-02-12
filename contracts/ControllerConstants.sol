// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;


contract ControllerConstants {
  // Minimum number of tokens in an index.
  uint256 public constant MIN_INDEX_SIZE = 2;

  // Maximum number of tokens in an index.
  uint256 public constant MAX_INDEX_SIZE = 10;

  // Minimum balance for a token (only applied at initialization)
  uint256 public constant MIN_BALANCE = 1e6;

  // Identifier for the pool initializer implementation on the proxy manager.
  bytes32 public constant INITIALIZER_IMPLEMENTATION_ID = keccak256("PoolInitializer.sol");

  // Identifier for the unbound token seller implementation on the proxy manager.
  bytes32 public constant SELLER_IMPLEMENTATION_ID = keccak256("UnboundTokenSeller.sol");

  // Identifier for the index pool implementation on the proxy manager.
  bytes32 public constant POOL_IMPLEMENTATION_ID = keccak256("IndexPool.sol");

  // Time between reweigh/reindex calls.
  uint256 public constant POOL_REWEIGH_DELAY = 1 weeks;

  // The number of reweighs which occur before a pool is re-indexed.
  uint8 public constant REWEIGHS_BEFORE_REINDEX = 3;

  // Default total weight for a pool.
  uint256 public constant WEIGHT_MULTIPLIER = 25e18;
}