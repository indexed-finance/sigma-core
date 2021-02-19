// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

/* ========== External Interfaces ========== */
import "@indexed-finance/uniswap-v2-oracle/contracts/interfaces/IIndexedUniswapV2Oracle.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/* ========== Internal Libraries ========== */
import "./lib/TokenSortLibrary.sol";

/* ========== Internal Interfaces ========== */
import "./interfaces/ICirculatingMarketCapOracle.sol";

/* ========== Internal Inheritance ========== */
import "./OwnableProxy.sol";


/**
 * @title MarketCapSortedTokenCategories
 * @author d1ll0n
 *
 * @dev This contract stores token categories created by the contract owner.
 *
 * ===== Token Categories =====
 * Each category is a list of tokens with a configuration for the minimum and maximum
 * market caps of included tokens, as well as a field indicating whether circulating
 * or fully diluted market caps are used.
 *
 * Token categories are sorted in descending order of the market caps of their tokens,
 * and filtered using the configured min/max bounds.
 *
 * The contract owner can create a new token category with a metadata hash used to query
 * additional details about its purpose and inclusion criteria.
 *
 * The owner can add and remove tokens from the categories at will.
 *
 * ===== Market Caps =====
 * Fully diluted market caps are extrapolated by multiplying tokens' total supplies
 * by their moving average weth prices on UniSwap.
 *
 * Circulating market caps are queried from an external oracle which is configured
 * by the owner.
 */
contract MarketCapSortedTokenCategories is OwnableProxy {
/* ==========  Constants  ========== */

  // TWAP parameters for capturing long-term price trends
  uint32 public constant LONG_TWAP_MIN_TIME_ELAPSED = 1 days;
  uint32 public constant LONG_TWAP_MAX_TIME_ELAPSED = 1.5 weeks;

  // TWAP parameters for assessing current price
  uint32 public constant SHORT_TWAP_MIN_TIME_ELAPSED = 20 minutes;
  uint32 public constant SHORT_TWAP_MAX_TIME_ELAPSED = 2 days;

  // Maximum time between a category being sorted and a query for the top n tokens
  uint256 public constant MAX_SORT_DELAY = 1 days;

  // Maximum number of tokens in a category
  uint256 public constant MAX_CATEGORY_TOKENS = 25;

  // Uniswap TWAP oracle
  IIndexedUniswapV2Oracle public immutable uniswapOracle;

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

/* ==========  Structs  ========== */

  /**
   * @dev Token category storage structure.
   * @param useFullyDilutedMarketCaps If true, use fully diluted market cap
   * rather than circulating market cap to sort and filter tokens.
   * @param minMarketCap Minimum market cap for included tokens
   * @param maxMarketCap Maximum market cap for included tokens
   * @param tokens The list of tokens in the category
   * @param isIncludedToken Mapping of included tokens
   */
  struct Category {
    bool useFullyDilutedMarketCaps;
    uint112 minMarketCap;
    uint112 maxMarketCap;
    address[] tokens;
    mapping(address => bool) isIncludedToken;
  }

/* ==========  Storage  ========== */

  // Chainlink or other circulating market cap oracle
  ICirculatingMarketCapOracle public circulatingMarketCapOracle;

  // Number of categories that exist.
  uint256 public categoryIndex;
  mapping(uint256 => Category) internal _categories;

/* ========== Modifiers ========== */

  modifier validCategory(uint256 categoryID) {
    require(categoryID <= categoryIndex && categoryID > 0, "ERR_CATEGORY_ID");
    _;
  }

/* ==========  Constructor  ========== */

  /**
   * @dev Deploy the controller and configure the addresses
   * of the related contracts.
   */
  constructor(IIndexedUniswapV2Oracle _oracle) public OwnableProxy() {
    uniswapOracle = _oracle;
  }

/* ==========  Configuration  ========== */

  /**
   * @dev Initialize the categories with the owner address.
   * This sets up the contract which is deployed as a singleton proxy.
   */
  function initialize(address circulatingMarketCapOracle_) public virtual {
    _initializeOwnership();
    circulatingMarketCapOracle = ICirculatingMarketCapOracle(circulatingMarketCapOracle_);
  }

  function setCirculatingMarketCapOracle(address circulatingMarketCapOracle_) external onlyOwner {
    circulatingMarketCapOracle = ICirculatingMarketCapOracle(circulatingMarketCapOracle_);
  }

/* ==========  Permissioned Category Management  ========== */

  /**
   * @dev Creates a new token category.
   *
   * @param metadataHash Hash of metadata about the token category
   * which can be distributed on IPFS.
   */
  function createCategory(
    bytes32 metadataHash,
    bool useFullyDilutedMarketCaps,
    uint112 minMarketCap,
    uint112 maxMarketCap
  )
    external
    onlyOwner
  {
    require(minMarketCap > 0, "ERR_NULL_MIN_CAP");
    require(maxMarketCap > minMarketCap, "ERR_MAX_CAP");
    uint256 categoryID = ++categoryIndex;
    _categories[categoryID].useFullyDilutedMarketCaps = useFullyDilutedMarketCaps;
    _categories[categoryID].minMarketCap = minMarketCap;
    _categories[categoryID].maxMarketCap = maxMarketCap;
    // _categoryMarketCapBounds[categoryID] = [minMarketCap, maxMarketCap];
    emit CategoryAdded(categoryID, metadataHash, useFullyDilutedMarketCaps, minMarketCap, maxMarketCap);
  }

  /**
   * @dev Adds a new token to a category.
   *
   * @param categoryID Category identifier.
   * @param token Token to add to the category.
   */
  function addToken(uint256 categoryID, address token) external onlyOwner validCategory(categoryID) {
    Category storage category = _categories[categoryID];
    require(
      category.tokens.length < MAX_CATEGORY_TOKENS,
      "ERR_MAX_CATEGORY_TOKENS"
    );
    _addToken(category, token);
    uniswapOracle.updatePrice(token);
    emit TokenAdded(token, categoryID);
  }

  /**
   * @dev Add tokens to a category.
   * @param categoryID Category identifier.
   * @param tokens Array of tokens to add to the category.
   */
  function addTokens(uint256 categoryID, address[] calldata tokens)
    external
    onlyOwner
    validCategory(categoryID)
  {
    Category storage category = _categories[categoryID];
    require(
      category.tokens.length + tokens.length <= MAX_CATEGORY_TOKENS,
      "ERR_MAX_CATEGORY_TOKENS"
    );
    for (uint256 i = 0; i < tokens.length; i++) {
      address token = tokens[i];
      _addToken(category, token);
      emit TokenAdded(token, categoryID);
    }
    uniswapOracle.updatePrices(tokens);
  }

  /**
   * @dev Remove token from a category.
   * @param categoryID Category identifier.
   * @param token Token to remove from the category.
   */
  function removeToken(uint256 categoryID, address token) external onlyOwner validCategory(categoryID) {
    Category storage category = _categories[categoryID];
    uint256 i = 0;
    uint256 len = category.tokens.length;
    require(len > 0, "ERR_EMPTY_CATEGORY");
    require(category.isIncludedToken[token], "ERR_TOKEN_NOT_BOUND");
    category.isIncludedToken[token] = false;
    for (; i < len; i++) {
      if (category.tokens[i] == token) {
        uint256 last = len - 1;
        if (i != last) {
          address lastToken = category.tokens[last];
          category.tokens[i] = lastToken;
        }
        category.tokens.pop();
        emit TokenRemoved(token, categoryID);
        return;
      }
    }
    // This will never occur.
    revert("ERR_NOT_FOUND");
  }

/* ==========  Public Category Updates  ========== */

  /**
   * @dev Updates the prices on the Uniswap oracle for all the tokens in a category.
   */
  function updateCategoryPrices(uint256 categoryID)
    external
    validCategory(categoryID)
    returns (bool[] memory pricesUpdated)
  {
    pricesUpdated = uniswapOracle.updatePrices(_categories[categoryID].tokens);
  }

  /**
   * @dev Updates the market caps for all the tokens in a category.
   */
  function updateCategoryMarketCaps(uint256 categoryID)
    external
    validCategory(categoryID)
  {
    Category storage category = _categories[categoryID];
    require(!category.useFullyDilutedMarketCaps, "ERR_NOT_CIRC_CAT");
    circulatingMarketCapOracle.updateCirculatingMarketCaps(category.tokens);
  }

  function sortAndFilterTokens(uint256 categoryID)
    external
    validCategory(categoryID)
  {
    (address[] memory categoryTokens,) = getSortedAndFilteredTokensAndMarketCaps(categoryID);
    _categories[categoryID].tokens = categoryTokens;
  }


/* ==========  Market Cap Queries  ========== */

  function getSortedAndFilteredTokensAndMarketCaps(uint256 categoryID)
    public
    view
    validCategory(categoryID)
    returns (
      address[] memory categoryTokens,
      uint256[] memory marketCaps
    )
  {
    Category storage category = _categories[categoryID];
    categoryTokens = category.tokens;
    marketCaps = getMarketCaps(category.useFullyDilutedMarketCaps, categoryTokens);
    TokenSortLibrary.sortAndFilter(
      categoryTokens,
      marketCaps,
      category.minMarketCap,
      category.maxMarketCap
    );
  }

  /**
   * @dev Compute the average fully-diluted market caps in weth for a set of tokens.
   * Queries the average amounts of ether that the total supplies are worth
   * using the recent moving average prices.
   */
  function getFullyDilutedMarketCaps(address[] memory tokens)
    public
    view
    returns (uint256[] memory marketCaps)
  {
    uint256 len = tokens.length;
    uint256[] memory totalSupplies = new uint256[](len);
    for (uint256 i = 0; i < len; i++) {
      totalSupplies[i] = IERC20(tokens[i]).totalSupply();
    }
    marketCaps = _to256Array(
      uniswapOracle.computeAverageEthForTokens(
        tokens,
        totalSupplies,
        LONG_TWAP_MIN_TIME_ELAPSED,
        LONG_TWAP_MAX_TIME_ELAPSED
      )
    );
  }

  /**
   * @dev Queries the circulating market caps for a set of tokens.
   */
  function getCirculatingMarketCaps(address[] memory tokens)
    public
    view
    returns (uint256[] memory marketCaps)
  {
    marketCaps = circulatingMarketCapOracle.getCirculatingMarketCaps(tokens);
  }

  /**
   * @dev Queries either the fully diluted or circulating market caps for a set of
   * tokens.
   *
   * @param useFullyDilutedMarketCaps Whether to use fully diluted market caps
   * @param tokens Array of tokens to query market caps for
   */
  function getMarketCaps(bool useFullyDilutedMarketCaps, address[] memory tokens)
    public
    view
    returns (uint256[] memory marketCaps)
  {
    if (useFullyDilutedMarketCaps) {
      marketCaps = getFullyDilutedMarketCaps(tokens);
    } else {
      marketCaps = getCirculatingMarketCaps(tokens);
    }
  }

/* ==========  Category Queries  ========== */

  /**
   * @dev Returns a boolean stating whether a category exists.
   */
  function hasCategory(uint256 categoryID) external view returns (bool) {
    return categoryID <= categoryIndex && categoryID > 0;
  }

  /**
   * @dev Returns boolean stating whether `token` is a member of the category `categoryID`.
   */
  function isTokenInCategory(uint256 categoryID, address token)
    external
    view
    validCategory(categoryID)
    returns (bool)
  {
    return _categories[categoryID].isIncludedToken[token];
  }

  /**
   * @dev Returns the array of tokens in a category.
   */
  function getCategoryTokens(uint256 categoryID)
    external
    view
    validCategory(categoryID)
    returns (address[] memory tokens)
  {
    tokens = _categories[categoryID].tokens;
  }

  function getTopCategoryTokensAndMarketCaps(uint256 categoryID, uint256 count)
    public
    view
    validCategory(categoryID)
    returns (
      address[] memory categoryTokens,
      uint256[] memory marketCaps
    )
  {
    (categoryTokens, marketCaps) = getSortedAndFilteredTokensAndMarketCaps(categoryID);
    require(count <= categoryTokens.length, "ERR_CATEGORY_SIZE");
    assembly {
      mstore(categoryTokens, count)
      mstore(marketCaps, count)
    }
  }

  /**
   * @dev Query the configuration values for a token category.
   *
   * @param categoryID Identifier for the category
   * @return useFullyDilutedMarketCaps Indicates whether fully diluted valuation is used
   * @return minMarketCap Minimum market cap for an included token
   * @return maxMarketCap Maximum market cap for an included token
   */
  function getCategoryConfig(uint256 categoryID)
    external
    view
    validCategory(categoryID)
    returns (
      bool useFullyDilutedMarketCaps,
      uint112 minMarketCap,
      uint112 maxMarketCap
    )
  {
    Category storage category = _categories[categoryID];
    useFullyDilutedMarketCaps = category.useFullyDilutedMarketCaps;
    minMarketCap = category.minMarketCap;
    maxMarketCap = category.maxMarketCap;
  }

/* ==========  Category Utility Functions  ========== */

  /**
   * @dev Adds a new token to a category.
   */
  function _addToken(Category storage category, address token) internal {
    require(!category.isIncludedToken[token], "ERR_TOKEN_BOUND");
    category.isIncludedToken[token] = true;
    category.tokens.push(token);
  }

  /**
   * @dev Convert a uint144 array to a uint256 array.
   */
  function _to256Array(uint144[] memory arrIn) internal pure returns (uint256[] memory arrOut) {
    assembly { arrOut := arrIn }
  }
}