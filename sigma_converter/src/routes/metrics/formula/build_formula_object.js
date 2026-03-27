const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { convertFilterToSigma } = require('../../filter/filter_converter');
const { convertExpressionToSigma } = require('../../dimensions/formula/build_sigma_formula');
const { toDisplayName } = require('../../../utils/column_name_config');

// matches a bare SQL identifier (letters, digits, underscores — no operators or spaces)
const SIMPLE_COLUMN_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * converts a measure expression to Sigma syntax with table qualification
 * simple column refs get table-qualified bracket notation;
 * complex expressions (CASE, COALESCE, etc.) go through the full SQL→Sigma pipeline
 * @param {string} expr - raw SQL expression from the measure definition
 * @param {string} [sourceName] - warehouse table name for qualified references
 * @returns {string} Sigma-compatible expression
 */
function convertMeasureExpr(expr, sourceName) {
  const trimmed = expr.trim();
  if (SIMPLE_COLUMN_RE.test(trimmed)) {
    const displayName = toDisplayName(trimmed);
    return sourceName ? `[${sourceName}/${displayName}]` : `[${displayName}]`;
  }
  return convertExpressionToSigma(trimmed, sourceName);
}

/**
 * build formula string from measure properties
 * @param {Object} measure - measure object
 * @param {string} [sourceName] - warehouse table name for qualified column references
 * @returns {Object} formula object containing the Sigma formula and constituent parts of the formula {formula, aggFunc, measureExpr, existingFilter}
 */
function buildMeasureFormula(measure, sourceName) {
  const { agg, expr } = measure;

  const convertedExpr = convertMeasureExpr(expr, sourceName);

  let aggFunc;
  let formula;
  switch (agg) {
    case 'count_distinct':
      aggFunc = 'countdistinct';
      formula = `countdistinct(${convertedExpr})`;
      break;
    case 'sum':
      aggFunc = 'sum';
      formula = `sum(${convertedExpr})`;
      break;
    case 'count':
      aggFunc = 'count';
      formula = `count(${convertedExpr})`;
      break;
    case 'avg':
      aggFunc = 'avg';
      formula = `avg(${convertedExpr})`;
      break;
    case 'min':
      aggFunc = 'min';
      formula = `min(${convertedExpr})`;
      break;
    case 'max':
      aggFunc = 'max';
      formula = `max(${convertedExpr})`;
      break;
    default:
      aggFunc = agg;
      formula = `${aggFunc}(${convertedExpr})`;
  }

  return {
    formula,
    aggFunc: aggFunc,
    measureExpr: expr,
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
function buildMeasureFormulaWithFilter(measure, filterStr, modelName, sourceName) {

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
  if (measureAgg === 'count') {
    formula = `${aggFunc}(${convertedFilter})`;
  } else {
    const convertedExpr = convertMeasureExpr(measureExpr, sourceName);
    formula = `${aggFunc}(${convertedExpr},${convertedFilter})`;
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

