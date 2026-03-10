const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { convertFilterToSigma } = require('../../filter/filter_converter');

/**
 * build formula string from measure properties
 * @param {Object} measure - measure object
 * @returns {Object} formula object containing the Sigma formula and constituent parts of the formula {formula, aggFunc, measureExpr, existingFilter}
 */
function buildMeasureFormula(measure) {
  const { agg, expr } = measure;

  const userFriendlyExpr = expr;
  
  let aggFunc;
  let formula;
  switch (agg) {
    case 'count_distinct':
      aggFunc = 'countdistinct';
      formula = `countdistinct([${userFriendlyExpr}])`;
      break;
    case 'sum':
      aggFunc = 'sum';
      formula = `sum([${userFriendlyExpr}])`;
      break;
    case 'count':
      aggFunc = 'count';
      formula = `count([${userFriendlyExpr}])`;
      break;
    case 'avg':
      aggFunc = 'avg';
      formula = `avg([${userFriendlyExpr}])`;
      break;
    case 'min':
      aggFunc = 'min';
      formula = `min([${userFriendlyExpr}])`;
      break;
    case 'max':
      aggFunc = 'max';
      formula = `max([${userFriendlyExpr}])`;
      break;
    default:
      aggFunc = agg;
      formula = `${aggFunc}([${userFriendlyExpr}])`;
  }
  
  return {
    formula,
    aggFunc: aggFunc,
    measureExpr: userFriendlyExpr,
    existingFilter: null
  };
}

/**
 * build formula string from measure with filter
 * @param {Object} measure - measure object
 * @param {string} filterStr - filter string
 * @param {string} modelName - semantic model name
 * @returns {Object} formula object containing the Sigma formula and constituent parts of the formula {formula, aggFunc, measureExpr, existingFilter}
 */
function buildMeasureFormulaWithFilter(measure, filterStr, modelName) {
  
  const measureExpr = measure.expr;
  const measureAgg = measure.agg;
  const convertedFilter = convertFilterToSigma(filterStr, modelName);

  const aggFunc = 
    measureAgg === 'sum' ? 'sumif' : 
    measureAgg === 'avg' ? 'avgif' : 
    measureAgg === 'min' ? 'minif' : 
    measureAgg === 'max' ? 'maxif' : 
    measureAgg === 'count' ? 'countif' : 
    measureAgg === 'count_distinct' ? 'countdistinctif' : null;
  
  let formula;
  // for countif, Sigma does not accept the measure being counted as a parameter
  if (measureAgg === 'count') {
    formula = `${aggFunc}(${convertedFilter})`;
  } else {
    formula = `${aggFunc}([${measureExpr}],${convertedFilter})`;
  }
  
  return {
    formula,
    aggFunc,
    measureExpr: measureAgg === 'count' ? null : measureExpr, // countif doesn't have measureExpr
    existingFilter: convertedFilter
  };
  
}

module.exports = {
  buildMeasureFormula,
  buildMeasureFormulaWithFilter
};

