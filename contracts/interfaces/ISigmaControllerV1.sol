// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;

import "@indexed-finance/uniswap-v2-oracle/contracts/interfaces/IIndexedUniswapV2Oracle.sol";


interface ISigmaControllerV1 {
/* ==========  Events  ========== */

  /** @dev Emitted when a new category is created. */
  event CategoryAdded(
    uint256 categoryID,
    bytes32 metadataHash,
    bool useFullyDilutedMarketCaps,
    uint128 minMarketCap,
    uint128 maxMarketCap
  );

  /** @dev Emitted when a category is sorted. */
  event CategorySorted(uint256 categoryID);

  /** @dev Emitted when a token is added to a category. */
  event TokenAdded(address token, uint256 categoryID);

  /** @dev Emitted when a token is removed from a category. */
  event TokenRemoved(address token, uint256 categoryID);

  /** @dev Emitted when a pool is initialized and made public. */
  event PoolInitialized(
    address pool,
    address unboundTokenSeller,
    uint256 categoryID,
    uint256 indexSize
  );

  /** @dev Emitted when a pool and its initializer are deployed. */
  event NewPoolInitializer(
    address pool,
    address initializer,
    uint256 categoryID,
    uint256 indexSize,
    WeightingFormula formula
  );

/* ==========  Structs  ========== */

  /**
   * @dev Data structure with metadata about an index pool.
   *
   * Includes the number of times a pool has been either reweighed
   * or re-indexed, as well as the timestamp of the last such action.
   *
   * To reweigh or re-index, the last update must have occurred at
   * least `POOL_REWEIGH_DELAY` seconds ago.
   *
   * If `++index % REWEIGHS_BEFORE_REINDEX + 1` is 0, the pool will
   * re-index, otherwise it will reweigh.
   *
   * The struct fields are assigned their respective integer sizes so
   * that solc can pack the entire struct into a single storage slot.
   * `reweighIndex` is intended to overflow, `categoryID` will never
   * reach 2**16, `indexSize` is capped at 10 and it is unlikely that
   * this protocol will be in use in the year 292277026596 (unix time
   * for 2**64 - 1).
   *
   * @param initialized Whether the pool has been initialized with the
   * starting balances.
   * @param categoryID Category identifier for the pool.
   * @param indexSize Number of tokens the pool should hold.
   * @param reweighIndex Number of times the pool has either re-weighed
   * or re-indexed.
   * @param lastReweigh Timestamp of last pool re-weigh or re-index.
   * @param formula Specifies the formula to use for weighting
   */
  struct IndexPoolMeta {
    bool initialized;
    uint16 categoryID;
    uint8 indexSize;
    uint8 reweighIndex;
    uint64 lastReweigh;
    WeightingFormula formula;
  }

  enum WeightingFormula { Proportional, Sqrt }

/* ========== Mutative ========== */

  function updateCategoryPrices(uint256 categoryID) external;

  function createCategory(bytes32 metadataHash) external;

  function addToken(uint256 categoryID, address token) external;

  function addTokens(uint256 categoryID, address[] calldata tokens) external;

  function removeToken(uint256 categoryID, address token) external;

  function orderCategoryTokensByMarketCap(uint256 categoryID) external;

/* ========== Views ========== */

  function categoryIndex() external view returns (uint256);

  function oracle() external view returns (IIndexedUniswapV2Oracle);

  function computeAverageMarketCap(address token) external view returns (uint144);

  function computeAverageMarketCaps(address[] calldata tokens) external view returns (uint144[] memory);

  function hasCategory(uint256 categoryID) external view returns (bool);

  function getLastCategoryUpdate(uint256 categoryID) external view returns (uint256);

  function isTokenInCategory(uint256 categoryID, address token) external view returns (bool);

  function getCategoryTokens(uint256 categoryID) external view returns (address[] memory);

  function getCategoryMarketCaps(uint256 categoryID) external view returns (uint144[] memory);

  function getTopCategoryTokens(uint256 categoryID, uint256 num) external view returns (address[] memory);
}