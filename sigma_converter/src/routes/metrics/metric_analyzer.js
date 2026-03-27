const { extractDimensionReferences, parseDimensionReference } = require('./dimension_parser');

/**
 * check if a metric can be added to the current model
 * @param {Object} metric - metric object from dbt
 * @param {Object} semanticModel - semantic model object
 * @param {Array} allMetrics - array of all metrics from source data (for checking if referenced metric is present as a metric in the source data)
 * @returns {boolean} true if all dimensions and measures/metrics used by the dbt metric are in the current model, false otherwise
 */
function canAddMetricToModel(metric, semanticModel, allMetrics = []) {
  // check metrics referenced in type_params.metrics (for derived metrics)
  if (metric.type_params?.metrics) {
    for (const refMetric of metric.type_params.metrics) {
      const metricName = typeof refMetric === 'string' ? refMetric : refMetric.name;
      
      // first check if the referenced metric is present as a measure in the semantic model
      const measureExists = semanticModel.measures?.some(m => m.name === metricName);
      if (measureExists) {
        continue;
      }
      
      // if the referenced metric is not present as a measure, check if it's present as a metric in the source data
      const metricExists = allMetrics.some(m => m.name === metricName);
      if (!metricExists) {
        return false;
      }
    }
  }

  // check measure reference for cumulative and simple metrics
  if (metric.type_params?.measure) {
    const measureRef = metric.type_params.measure;
    const measureName = typeof measureRef === 'string' ? measureRef : measureRef.name;
    const measureExists = semanticModel.measures?.some(m => m.name === measureName);
    if (!measureExists) {
      const metricExists = allMetrics.some(m => m.name === measureName);
      if (!metricExists) {
        return false;
      }
    }
  }

  // check numerator and denominator for ratio metrics
  if (metric.type === 'ratio' && metric.type_params) {
    const { numerator, denominator } = metric.type_params;
    
    if (numerator) {
      const numeratorName = typeof numerator === 'string' ? numerator : numerator.name;
      const numeratorMeasureExists = semanticModel.measures?.some(m => m.name === numeratorName);
      if (!numeratorMeasureExists) {
        const numeratorMetricExists = allMetrics.some(m => m.name === numeratorName);
        if (!numeratorMetricExists) {
          return false;
        }
      }
    }
    
    if (denominator) {
      const denominatorName = typeof denominator === 'string' ? denominator : denominator.name;
      const denominatorMeasureExists = semanticModel.measures?.some(m => m.name === denominatorName);
      if (!denominatorMeasureExists) {
        const denominatorMetricExists = allMetrics.some(m => m.name === denominatorName);
        if (!denominatorMetricExists) {
          return false;
        }
      }
    }
  }

  // extract and check dimension references
  const dimensionRefs = extractDimensionReferences(metric);
  for (const dimRef of dimensionRefs) {
    const { modelName, dimensionName } = parseDimensionReference(dimRef);

    // check if the dimension is present in one of the entities referenced by the semantic model
    const dimensionExists = semanticModel.entities?.some(e => e.name === modelName);
    if (!dimensionExists) {
      return false;
    }
  }

  return true;
}

module.exports = {
  canAddMetricToModel
};

