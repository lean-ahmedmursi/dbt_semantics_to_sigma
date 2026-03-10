const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { canAddMetricToModel, convertMetricToSigma, buildMeasureFormula } = require('../metrics');
const { buildDimensionFormula, buildEntityExpressionFormula } = require('../dimensions/formula/build_sigma_formula');
const { convertToUserFriendlyName } = require('../dimensions/utils/convertToUserFriendlyName');
const { addTimeRelationships } = require('../time');
const { sanitizePath } = require('./path_utils');

/**
 * rewrites column formulas for foreign entity data models to use the current entity name instead of the source in the referenced data model.
 * the column formula in the referenced data model may refer to the warehouse table. the current data model needs to refer to the name of the table in the referenced data model..
 * e.g. [D_CUSTOMER/Cust Key] -> [d_customer/Cust Key]
 * @param {Array} columns - columns from foreign entity's Sigma model
 * @param {string} entityName - the entity name in the current model context
 * @returns {Array} columns with updated formulas
 */
function rewriteColumnFormulasForForeignEntity(columns, entityName) {
  if (!columns || !entityName) return columns;
  return columns.map(col => {
    if (!col.formula || typeof col.formula !== 'string') return col;
    return {
      ...col,
      formula: `[${entityName}/${col.name}]`
    };
  });
}

/**
 * get warehouse table path [database, schema, table] from manifest's node_relation.
 * assumes the semantic model and node_relation exist in the manifest.
 * @param {Object} manifest - parsed semantic_manifest.json
 * @param {string} semanticModelName - name of semantic model (matches primaryEntity.name)
 * @returns {[string, string, string]} [database, schema, table]
 */
function getWhTableFromManifest(manifest, semanticModelName) {
  const model = manifest.semantic_models.find(m => m.name === semanticModelName);
  const nr = model.node_relation;
  const table = nr.relation_name.split('.').pop().replace(/`/g, '');
  return [nr.database, nr.schema_name, table];
}

/**
 * converts dbt semantic layer YAML to target format
 * @param {string} sourceFilePath - path to source YAML file
 * @param {string} targetFilePath - path to output YAML file
 * @param {Object} options - conversion options
 * @param {string} options.dataModelFolder - data model folder path
 * @param {string} options.connectionId - connection ID for target
 * @param {string} options.tableName - table name
 * @param {string} options.sigmaModelDir - path to sigma_model directory for foreign key lookups
 * @param {string} options.modelName - name of the semantic model to process (required when multiple models exist in file)
 * @param {string} options.timeSpineFile - _models.yml file for time spine models
 * @param {Array<Object>} options.foreignEntities - foreign entities from DAG with semanticModelName
 * @param {string} options.manifestPath - path to semantic_manifest.json
 */
function convertSemantics(sourceFilePath, targetFilePath, options = {}) {
  try {
    // read and parse dbt semantics YAML
    const sourceContent = fs.readFileSync(sourceFilePath, 'utf8');
    const sourceData = yaml.load(sourceContent);

    // find semantic model by name if provided, otherwise use first one
    let semanticModel;
    if (options.modelName) {
      semanticModel = sourceData.semantic_models?.find(model => model.name === options.modelName);
      if (!semanticModel) {
        throw new Error(`Semantic model '${options.modelName}' not found in source file ${sourceFilePath}`);
      }
    } else {
      // fallback to first semantic model if no name specified
      semanticModel = sourceData.semantic_models?.[0];
      if (!semanticModel) {
        throw new Error('No semantic model found in source file');
      }
      if (sourceData.semantic_models?.length > 1) {
        console.warn(`Warning: Multiple semantic models found in ${sourceFilePath}, but no modelName specified. Using first model: ${semanticModel.name}`);
      }
    }

    // find primary entity
    const primaryEntity = semanticModel.entities?.find(entity => entity.type === 'primary');
    if (!primaryEntity) {
      console.warn(`Warning: No primary entity found in semantic model ${semanticModel.name}`);
    }

    // path from manifest node_relation (model and node_relation assumed to exist)
    const manifest = JSON.parse(fs.readFileSync(options.manifestPath, 'utf8'));
    const whTablePath = getWhTableFromManifest(manifest, semanticModel.name);

    // build structure for Sigma data model
    // this section handles sourcing tables from the connection
    let targetData = {
      ...(options.dataModelId && { dataModelId: options.dataModelId }),
      name: semanticModel.name,
      schemaVersion: 1,
      folderId: options.sigmaFolderId,
      pages: [{
        id: '1',
        name: semanticModel.name,
        description: semanticModel.description,
        elements: [{
          id: primaryEntity.name,
          name: primaryEntity.name,
          description: primaryEntity.name,
          kind: 'table',
          source: {
            name: primaryEntity.name,
            kind: 'warehouse-table',
            connectionId: options.connectionId || '$connectionId',
            path: whTablePath
          },
          columns: [],
          filters: [],
          folders: [],
          metrics: [],
          relationships: [],
          joins: []
        }]
      }]
    };

    const userFriendlyColumnNameFlag = process.env.USER_FRIENDLY_COLUMN_NAMES;

    // convert dbt semantics dimensions to Sigma data model columns
    if (semanticModel.dimensions) {

      semanticModel.dimensions.forEach(dimension => {

        // if process.env.USER_FRIENDLY_COLUMN_NAMES is true, convert the dimension name to a user friendly name
        const userFriendlyDimensionName = userFriendlyColumnNameFlag === 'true' 
          ? convertToUserFriendlyName(dimension.name) 
          : dimension.name;
        
        const column = {
          id: `${dimension.name}`,
          name: dimension.name,
          description: dimension.description,
          formula: buildDimensionFormula(dimension, whTablePath[2], userFriendlyDimensionName)
        };

        // add synonyms if available
        if (dimension.config?.meta?.synonyms) {
          const synonyms = dimension.config.meta.synonyms.join(', ');
          column.description += ` Synonyms: ${synonyms}`;
        }

        targetData.pages[0].elements[0].columns.push(column);
      });
    }

    // convert entity expressions to Sigma data model columns
    if (semanticModel.entities) {

      semanticModel.entities.forEach(entity => {

        // if there is no expr, the entity name references a column in the underlying table
        // this column is not going to be present as a dimension in the dbt semantic model
        // and therefore, needs to be added in the Sigma data model

        // if the entity has an expression, create a column with id and name = semanticmodel_name__entity_name
        // the expression needs to be converted to Sigma formula syntax
        const column = {
          id: `${semanticModel.name}__${entity.name}`,
          name: `${semanticModel.name}__${entity.name}`,
          formula: buildEntityExpressionFormula(entity, semanticModel.name)
        };

        targetData.pages[0].elements[0].columns.push(column);
        
      });
      
    }

    // find entities with type foreign
    // Sigma data models for foreign entities have already been created
    // exports of Sigma data models are stored in the sigma_model folder
    const foreignEntities = semanticModel.entities?.filter(entity => entity.type === 'foreign') || [];
    const foreignEntityData = {};
    
    // use foreignEntities from DAG if provided (passed from layer_processor)
    const dagForeignEntities = options.foreignEntities || [];
    
    // for each foreign entity, read the corresponding sigma model file
    for (const entity of foreignEntities) {
      const entityName = entity.name;
      
      // get semanticModelName from DAG foreignEntities if available
      let sigmaModelFileName = entityName;
      let semanticModelName = null;
      
      const foreignEntityInDag = dagForeignEntities.find(fe => fe.name === entityName);
      if (foreignEntityInDag && foreignEntityInDag.semanticModelName) {
        semanticModelName = foreignEntityInDag.semanticModelName;
        sigmaModelFileName = foreignEntityInDag.semanticModelName;
      }
      
      // sanitize to prevent path traversal (sigma model dir is flat: modelName.yml)
      const sigmaModelPath = sanitizePath(`${sigmaModelFileName}.yml`, options.sigmaModelDir);
      
      if (fs.existsSync(sigmaModelPath)) {
        try {
          const sigmaModelContent = fs.readFileSync(sigmaModelPath, 'utf8');
          const sigmaModelData = yaml.load(sigmaModelContent);
          // find element in Sigma model with same name as the foreign entity
          const matchingElement = sigmaModelData.pages?.[0]?.elements?.find(element => element.name === entityName);
          foreignEntityData[entityName] = {
            datamodelId: sigmaModelData.dataModelId,
            tableId: matchingElement?.id,
            columns: matchingElement?.columns,
            expr: entity.expr,
            semanticModelName: semanticModelName
          };
        } catch (error) {
          console.warn(`Could not read sigma model file for ${entityName}:`, error.message);
        }
      } else {
        console.warn(`Sigma model file not found for foreign entity: ${entityName} at ${sigmaModelPath}`);
      }
    }

    /*
    // add foreign entity sources and joins
    for (const [entityName, entityData] of Object.entries(foreignEntityData)) {
      if (entityData.datamodelId && entityData.tableId) {
        // add Sigma data model element corresponding to foreign entity
        targetData.pages[0].elements[0].sources.push({
          name: entityName,
          kind: 'dataModel',
          id: entityData.datamodelId,
          element: entityData.tableId
        });

        // add join for foreign entity
        targetData.pages[0].elements[0].joins.push({
          op: 'left-outer',
          source: semanticModel.name,
          with: entityName,
          columns: [{
            source: entityData.expr,
            with: entityData.expr,
            condition: '='
          }]
        });
      }
    } */

    // add foreign entity sources for relationships
    for (const [entityName, entityData] of Object.entries(foreignEntityData)) {
      if (entityData.datamodelId && entityData.tableId) {
        // add Sigma data model element corresponding to foreign entity
        targetData.pages[0].elements.push({
          id: entityName,
          name: entityName,
          description: entityName,
          kind: 'table',
          source: {
            name: entityName,
            kind: 'data-model',
            dataModelId: entityData.datamodelId,
            elementId: entityData.tableId
          },
          columns: rewriteColumnFormulasForForeignEntity (entityData.columns, entityName),
          filters: [],
          folders: [],
          metrics: [],
          relationships: [],
          joins: []
        });

        // add relationship to primary entity
        // find the target column ID by matching the column name pattern
        const targetColumnName = `${entityData.semanticModelName}__${entityName}`;
        const targetColumn = entityData.columns?.find(col => col.name === targetColumnName);
        const targetColumnId = targetColumn?.id || `${entityData.semanticModelName}__${entityName}`;
        
        targetData.pages[0].elements[0].relationships.push({
          id: `${semanticModel.name}__${entityName}`,
          name: `${semanticModel.name}__${entityName}`,
          targetElementId: entityName,
          keys: [{
            sourceColumnId: `${semanticModel.name}__${primaryEntity.name}`,
            targetColumnId: targetColumnId
          }],
          relationshipType: 'N:1'
        });
      }
    }
    
    // ****************************************************
    // process dbt measures
    // ****************************************************
    // TODO: handle create_metric property
    // convert dbt semantics measures to Sigma data model metrics
    if (semanticModel.measures) {
      semanticModel.measures.forEach(measure => {
        const formulaObject = buildMeasureFormula(measure);
        const metric = {
          id: `${measure.name}`,
          name: measure.name,
          description: measure.description,
          formula: formulaObject.formula
        };

        targetData.pages[0].elements[0].metrics.push(metric);
      });
    }

    // ****************************************************
    // process dbt metrics
    // ****************************************************
    const crossModelMetrics = [];

    // map of already converted metrics (name -> formula)
    const convertedMetrics = {};

    if (sourceData.metrics) {
      // process metrics in three passes:
      // 1. first pass: simple metrics (which reference measures)
      // 2. second pass: derived metrics (which may reference other metrics)
      // 3. third pass: ratio metrics (reference other metrics)
      const simpleMetrics = sourceData.metrics.filter(m => m.type === 'simple');
      const derivedMetrics = sourceData.metrics.filter(m => m.type === 'derived');
      const ratioMetrics = sourceData.metrics.filter(m => m.type === 'ratio');

      // process simple metrics first
      simpleMetrics.forEach(metric => {
        const canAddToCurrentModel = canAddMetricToModel(
          metric,
          semanticModel,
          sourceData.metrics || []
        );

        if (canAddToCurrentModel) {
          // add metric to current model if all dimensions and measures used by the dbt metric are in the current model
          const sigmaMetric = convertMetricToSigma(metric, semanticModel, sourceData.metrics || [], convertedMetrics);
          if (sigmaMetric.formula) {
            targetData.pages[0].elements[0].metrics.push(sigmaMetric);
          }
        } else {
          // add to cross-model metrics if any dimensions or measures used by the dbt metric are not in the current model
          crossModelMetrics.push(metric);
        }
      });

      // process derived metrics second (they can now reference already-converted metrics)
      derivedMetrics.forEach(metric => {
        const canAddToCurrentModel = canAddMetricToModel(
          metric,
          semanticModel,
          sourceData.metrics || []
        );

        if (canAddToCurrentModel) {
          // add metric to current model if all dimensions and measures/metrics used by the dbt metric are in the current model
          const sigmaMetric = convertMetricToSigma(metric, semanticModel, sourceData.metrics || [], convertedMetrics);
          if (sigmaMetric.formula) {
            targetData.pages[0].elements[0].metrics.push(sigmaMetric);
          }
        } else {
          // add to cross-model metrics if any dimensions or measures/metrics used by the dbt metric are not in the current model
          crossModelMetrics.push(metric);
        }
      });

      // process ratio metrics third (they can now reference already-converted metrics)
      ratioMetrics.forEach(metric => {
        const canAddToCurrentModel = canAddMetricToModel(
          metric,
          semanticModel,
          sourceData.metrics || []
        );

        if (canAddToCurrentModel) {
          // add metric to current model if all metrics used by the dbt metric are in the current model
          const sigmaMetric = convertMetricToSigma(metric, semanticModel, sourceData.metrics || [], convertedMetrics);
          if (sigmaMetric.formula) {
            targetData.pages[0].elements[0].metrics.push(sigmaMetric);
          }
        } else {
          // add to cross-model metrics if any dimensions or metrics used by the dbt metric are not in the current model
          crossModelMetrics.push(metric);
        }
      });
    }

    // ****************************************************
    // process time spine relationships
    // ****************************************************
    if (options.timeSpineFile) {
      targetData = addTimeRelationships(targetData, semanticModel, options.timeSpineFile, {
        connectionId: options.connectionId,
        manifestPath: options.manifestPath
      });
    } else {
      console.warn('modelsFilePath not provided, skipping time dimension processing');
    }

    // write target YAML
    const targetYaml = yaml.dump(targetData, {
      indent: 2,
      lineWidth: -1,
      noRefs: true,
      sortKeys: false,
      forceQuotes: false,
      quotingType: '"'
    });

    fs.writeFileSync(targetFilePath, targetYaml);
    
    
    /*
    // write equivalent JSON file under output/json
    const outputDir = path.dirname(targetFilePath);
    const jsonDir = path.join(outputDir, 'json');
    if (!fs.existsSync(jsonDir)) {
      fs.mkdirSync(jsonDir, { recursive: true });
    }
    const jsonFileName = path.basename(targetFilePath, path.extname(targetFilePath)) + '.json';
    const jsonFilePath = path.join(jsonDir, jsonFileName);
    fs.writeFileSync(jsonFilePath, JSON.stringify(targetData, null, 2));
    */
    
    
    // write cross-model metrics if any
    if (crossModelMetrics.length > 0) {
      const crossModelFilePath = path.join(path.dirname(targetFilePath), 'cross_model_metrics.yml');
      let crossModelData = { metrics: [] };
      
      // Read existing cross_model_metrics.yml if it exists
      if (fs.existsSync(crossModelFilePath)) {
        try {
          const existingContent = fs.readFileSync(crossModelFilePath, 'utf8');
          const existingData = yaml.load(existingContent);
          if (existingData && existingData.metrics) {
            crossModelData.metrics = existingData.metrics;
          }
        } catch (error) {
          console.warn(`Could not read existing cross_model_metrics.yml: ${error.message}`);
        }
      }
      
      // add new cross-model metrics (avoid duplicates)
      crossModelMetrics.forEach(metric => {
        const exists = crossModelData.metrics.some(m => m.name === metric.name);
        if (!exists) {
          crossModelData.metrics.push(metric);
        }
      });
      
      const crossModelYaml = yaml.dump(crossModelData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
        forceQuotes: false,
        quotingType: '"'
      });
      
      fs.writeFileSync(crossModelFilePath, crossModelYaml);
      console.log(`Added ${crossModelMetrics.length} cross-model metric(s) to ${crossModelFilePath}`);
    }
    
    console.log(`Successfully converted ${sourceFilePath} to ${targetFilePath}`);
    return targetData;

  } catch (error) {
    console.error('Conversion error:', error.message);
    throw error;
  }
}

/**
 * Batch convert multiple files
 * @param {Array} files - Array of file conversion objects
 * @param {string} files[].source - Source file path
 * @param {string} files[].target - Target file path
 * @param {Object} files[].options - Conversion options
 */
function batchConvert(files) {
  const results = [];
  
  files.forEach((file, index) => {
    try {
      console.log(`Converting file ${index + 1}/${files.length}: ${file.source}`);
      const result = convertSemantics(file.source, file.target, file.options);
      results.push({ success: true, file: file.source, result });
    } catch (error) {
      console.error(`Failed to convert ${file.source}:`, error.message);
      results.push({ success: false, file: file.source, error: error.message });
    }
  });
  
  return results;
}

/**
 * Convert directory of YAML files
 * @param {string} sourceDir - Source directory path
 * @param {string} targetDir - Target directory path
 * @param {Object} defaultOptions - Default options for all files
 */
function convertDirectory(sourceDir, targetDir, defaultOptions = {}) {
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files = fs.readdirSync(sourceDir)
    .filter(file => file.endsWith('.yml') || file.endsWith('.yaml'))
    .map(file => ({
      source: path.join(sourceDir, file),
      target: path.join(targetDir, file),
      options: defaultOptions
    }));

  return batchConvert(files);
}

module.exports = {
  convertSemantics,
  batchConvert,
  convertDirectory
};
