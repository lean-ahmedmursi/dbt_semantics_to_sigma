const { buildMeasureFormula, buildMeasureFormulaWithFilter } = require('./build_formula_object');
const { convertFilterToSigma } = require('../../filter/filter_converter');
const { combineFilters, rebuildFilteredFormula } = require('../../filter/filter_utils');

/**
 * build Sigma formula for a metric referenced in type_params.metrics
 * @param {Object} typeParamMetric - metric referenced in type_params.metrics
 * @param {Object} semanticModel - semantic model object
 * @param {Array} allMetrics - array of all metrics from source data (for checking if referenced metric is present as a metric in the source data)
 * @param {Object} convertedMetrics - map of already converted metrics (name -> {formula, aggFunc, measureExpr, existingFilter})
 * @param {Function} convertMetricToSigma - function to convert metric to Sigma (to handle circular dependency)
 * @returns {string|null} Sigma formula string or null if measure/metric not found
 */
function buildSigmaMeasureFormula(typeParamMetric, semanticModel, allMetrics = [], convertedMetrics = {}, convertMetricToSigma) {
  
  const metricName = typeof typeParamMetric === 'string' ? typeParamMetric : typeParamMetric.name;
  
  const measure = semanticModel.measures?.find(m => m.name === metricName);

  // if the referenced metric is present as a measure, build the formula using the measure
  if (measure) {

    let sigmaFormulaObject;

    // check if metric reference has a filter
    if (typeof typeParamMetric === 'object' && typeParamMetric.filter) {
      const filterStr = typeof typeParamMetric.filter === 'string'
        ? typeParamMetric.filter
        : JSON.stringify(typeParamMetric.filter);
      sigmaFormulaObject = buildMeasureFormulaWithFilter(measure, filterStr, semanticModel.name);
    } else {
      // prefer pre-built formula from convertedMetrics (already table-qualified)
      sigmaFormulaObject = convertedMetrics[metricName] || buildMeasureFormula(measure);
    }

    // store formula object in convertedMetrics for future use
    convertedMetrics[metricName] = sigmaFormulaObject;

    return sigmaFormulaObject.formula;

  }

  // if the referenced metric is not present as a measure, check if it's present as a metric in the source data
  const referencedMetric = allMetrics.find(m => m.name === metricName);
  if (referencedMetric) {
    // check if we've already converted this metric
    let referencedMetricFormulaObject = convertedMetrics[metricName];
    
    // if the referenced metric is not yet converted, try to convert it now
    if (!referencedMetricFormulaObject) {
      const convertedMetric = convertMetricToSigma(referencedMetric, semanticModel, allMetrics, convertedMetrics);
      if (convertedMetric && convertedMetric.formula) {
        referencedMetricFormulaObject = convertedMetrics[metricName];
      } else {
        return null;
      }
    }
    
    // if the metric being processed has a filter in type_params, combine it with the referenced metric's filter
    // typeParamMetric.filter is the filter for the metric being processed
    // referencedMetricFormulaObject.existingFilter is the filter from the referenced metric (already converted to Sigma)
    if (typeof typeParamMetric === 'object' && typeParamMetric.filter) {
      const newFilterStr = typeof typeParamMetric.filter === 'string' 
        ? typeParamMetric.filter 
        : JSON.stringify(typeParamMetric.filter);
      const convertedNewFilter = convertFilterToSigma(newFilterStr, semanticModel.name);
      
      if (referencedMetricFormulaObject && referencedMetricFormulaObject.aggFunc && referencedMetricFormulaObject.existingFilter !== null && referencedMetricFormulaObject.existingFilter !== undefined) {
        // combine the filter from the referenced metric with the filter from the metric being processed
        const combinedFilter = combineFilters(referencedMetricFormulaObject.existingFilter, convertedNewFilter);
        const combinedFormula = rebuildFilteredFormula(referencedMetricFormulaObject.aggFunc, referencedMetricFormulaObject.measureExpr, combinedFilter);
        
        // store formula object for the metric being processed
        convertedMetrics[metricName] = {
          formula: combinedFormula,
          aggFunc: referencedMetricFormulaObject.aggFunc,
          measureExpr: referencedMetricFormulaObject.measureExpr,
          existingFilter: combinedFilter
        };
        
        return combinedFormula;
      } else if (referencedMetricFormulaObject && referencedMetricFormulaObject.formula) {
        return referencedMetricFormulaObject.formula;
      }
    }
    
    return referencedMetricFormulaObject ? referencedMetricFormulaObject.formula : null;

  }

  return null;

}

module.exports = {
  buildSigmaMeasureFormula
};

