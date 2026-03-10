const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { extractAggTimeDimensions } = require('./extract_agg_time_dimensions');
const { findTimeGranularity } = require('./find_time_granularity');
const { findTimeSpineColumn } = require('./find_time_spine_column');
const { buildTimeSpineGranularityMap } = require('./build_time_spine_granularity_map');
const { convertToUserFriendlyName } = require('../dimensions/utils/convertToUserFriendlyName');

/**
 * get warehouse table path [database, schema, table] from manifest's project_configuration.time_spines.
 * @param {Object} manifest - parsed semantic_manifest.json
 * @param {string} timeSpineName - alias of the time spine (matches node_relation.alias)
 * @returns {[string, string, string]|null} [database, schema, table] or null if not found
 */
function getTimeSpineWhTableFromManifest(manifest, timeSpineName) {
  const timeSpines = manifest.project_configuration?.time_spines || [];
  const timeSpine = timeSpines.find(ts => ts.node_relation?.alias === timeSpineName);
  if (!timeSpine) return null;
  const nr = timeSpine.node_relation;
  const table = nr.relation_name.split('.').pop();
  return [nr.database, nr.schema_name, table];
}

/**
 * Adds time_spine elements and relationships to the target data structure
 * @param {Object} targetData - The target Sigma data model structure
 * @param {Object} semanticModel - The semantic model object
 * @param {string} timeSpineFile - _models.yml file for time spine models
 * @param {Object} options - Conversion options (connectionId, manifestPath)
 * @returns {Object} - Updated targetData with time_spine elements and relationships
 */
function addTimeRelationships(targetData, semanticModel, timeSpineFile, options = {}) {
  
  // ****************************************************
  // STEP 1: in each semantic model yml, search for all agg_time_dimension values. these will either be present under semantic_models::defaults or semantic_models::measures::agg_time_dimension
  const aggTimeDimensions = extractAggTimeDimensions(semanticModel);
  
  if (aggTimeDimensions.length === 0) {
    return targetData;
  }

  // find primary entity for relationship creation
  const primaryEntity = semanticModel.entities?.find(entity => entity.type === 'primary');
  if (!primaryEntity) {
    console.warn('No primary entity found, cannot create time dimension relationships');
    return targetData;
  }

  // track unique time_spine elements to avoid duplicates
  const addedTimeSpines = new Map(); // granularity -> elementId

  // ****************************************************
  // STEP 2.5: create a map from timeSpineFile containing for each model under models:
  //   - standard_granularity_column
  //   - the granularity of the standard_granularity_column
  //   - the entire model
  //   granularity should be the key for the map
  const timeSpineGranularityMap = buildTimeSpineGranularityMap(timeSpineFile);

  // ****************************************************
  // STEP 2: for EACH agg_time_dimension, look for a dimension with that name and read the dimension's time_granularity
  aggTimeDimensions.forEach(aggTimeDimension => {
    const granularity = findTimeGranularity(semanticModel, aggTimeDimension);
    if (!granularity) {
      console.warn(`No time_granularity found for dimension: ${aggTimeDimension}`);
      return;
    }

    // skip if we've already added this granularity
    if (addedTimeSpines.has(granularity)) {
      return;
    }

    // ****************************************************
    // STEP 3: search the map created in step 2.5 for granularity. this is the timeSpineElement that needs to be used in step 4
    const timeSpineInfo = findTimeSpineColumn(timeSpineGranularityMap, granularity);
 
    if (!timeSpineInfo) {
      console.warn(`No time_spine column found for granularity: ${granularity}`);
      return;
    }

    // create unique element ID for this time_spine
    const timeSpineElementId = `ts_${granularity}`;
    addedTimeSpines.set(granularity, timeSpineElementId);

    // ****************************************************
    // STEP 4: add an element to the semantic model with the source as warehouse-table
    const timeSpineModel = timeSpineInfo.model;
    const timeSpineColumns = [];

    userFriendlyColumnNameFlag = process.env.USER_FRIENDLY_COLUMN_NAMES;

    // path from manifest time_spines node_relation (time_spine and node_relation assumed to exist)
    const manifest = JSON.parse(fs.readFileSync(options.manifestPath, 'utf8'));
    const timeSpineWhTablePath = getTimeSpineWhTableFromManifest(manifest, timeSpineInfo.timeSpineName);
    
    if (timeSpineModel.columns) {
      timeSpineModel.columns.forEach(col => {

        // if process.env.USER_FRIENDLY_COLUMN_NAMES is true, convert the column name to a user friendly name
        const userFriendlyDimensionName = userFriendlyColumnNameFlag === 'true' 
          ? convertToUserFriendlyName(col.name) 
          : col.name;

        const column = {
          id: `${timeSpineElementId}__${col.name}`,
          name: `${timeSpineElementId}__${col.name}`,
          description: col.description || '',
          formula: `[${timeSpineWhTablePath[2]}/${userFriendlyDimensionName}]`
        };
        timeSpineColumns.push(column);
      });
    }
    
    const timeSpineElement = {
      id: timeSpineElementId,
      name: timeSpineInfo.timeSpineName,
      description: `Time spine table for ${granularity} granularity`,
      kind: 'table',
      source: {
        name: timeSpineInfo.timeSpineName,
        kind: 'warehouse-table',
        connectionId: options.connectionId || '$connectionId',
        path: timeSpineWhTablePath
      },
      columns: timeSpineColumns,
      filters: [],
      folders: [],
      metrics: [],
      relationships: [],
      joins: []
    };

    targetData.pages[0].elements.push(timeSpineElement);

    // find the dimension for the agg_time_dimension
    // column IDs use the format: ${dimension.name}
    const dimension = semanticModel.dimensions?.find(dim => dim.name === aggTimeDimension);
    if (!dimension) {
      console.warn(`Dimension ${aggTimeDimension} not found in semantic model`);
      return;
    }

    // ****************************************************
    // STEP 5: create a relationship between the primary entity and the element added in step 4
    const relationship = {
      id: `${semanticModel.name}__${timeSpineElementId}`,
      name: `${semanticModel.name}__${timeSpineElementId}`,
      targetElementId: timeSpineElementId,
      keys: [{
        sourceColumnId: `${dimension.name}`,
        targetColumnId: `${timeSpineElementId}__${timeSpineInfo.columnName}`
      }],
      relationshipType: 'N:1'
    };

    // add relationship to primary entity element
    const primaryElement = targetData.pages[0].elements.find(el => el.id === primaryEntity.name);
    if (primaryElement) {
      primaryElement.relationships.push(relationship);
    } else {
      console.warn(`Primary element ${primaryEntity.name} not found in target data`);
    }
  });

  return targetData;
}

module.exports = {
  addTimeRelationships
};

