const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { convertSemantics } = require('./convert_semantics');
const { createDataModelInSigma } = require('../sigma_api/create_data_model');
const { updateDataModelInSigma } = require('../sigma_api/update_data_model');
const { getDataModelFromSigma } = require('../sigma_api/get_data_model');
const { sanitizePath } = require('./path_utils');
const yaml = require('js-yaml');

/**
 * layer-by-layer processor for DAG-based semantic model conversion
 */
class LayerProcessor {
  constructor(options = {}) {
    this.dagFile = options.dagFile;
    this.manifestPath = options.manifestPath;
    this.timeSpineFile = options.timeSpineFile;
    this.sourceDir = options.sourceDir;
    this.outputDir = options.outputDir;
    this.sigmaModelDir = options.sigmaModelDir;
    this.sigmaFolderId = options.sigmaFolderId;
    this.connectionId = options.connectionId;
    this.mode = options.mode || 'initial'; // 'initial' or 'update'

    // ensure directories exist
    this.ensureDirectories();
  }

  /**
   * ensure all required directories exist
   */
  ensureDirectories() {
    [this.outputDir, this.sigmaModelDir].forEach(dir => {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`Created directory: ${dir}`);
      }
    });
  }


  /**
   * generate a GUID for data model ID
   * @returns {string} Generated GUID
   */
  generateSigmaDataModelId() {
    return uuidv4();
  }

  /**
   * placeholder function for Sigma API call to create data model
   * @param {string} modelName - Name of the model
   * @param {Object} modelData - Model data to create
   * @returns {Promise<string>} Data model ID
   */
  async createDummySigmaDataModel(modelName, modelData) {
    // TODO: Replace with actual Sigma API call
    console.log(`[PLACEHOLDER] Creating Sigma data model for: ${modelName}`);
    //console.log(`[PLACEHOLDER] Model data:`, JSON.stringify(modelData, null, 2));
    
    // simulate API delay
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // return generated GUID
    return this.generateSigmaDataModelId();
  }

  /**
   * generate IDs and copy processed file to sigma_model folder. this is a dummy function for testing.
   * @param {string} sourceFilePath - path to the processed file
   * @param {string} modelName - name of the model
   * @param {string} dataModelId - guid for the data model
   */
  generateIDsAndCopyModelToSigmaFolder(sourceFilePath, modelName, dataModelId) {
    try {
      // read the processed file
      const processedContent = fs.readFileSync(sourceFilePath, 'utf8');
      
      // parse YAML to modify the ID
      const yaml = require('js-yaml');
      const data = yaml.load(processedContent);
      
      // create a new object with ID at the beginning
      const newData = {
        dataModelId: dataModelId,
        name: data.name,
        entity: data.entity,
        path: data.path,
        pages: data.pages
      };
      
      // also add ID to the table element if it exists
      if (newData.pages && newData.pages[0] && newData.pages[0].elements && newData.pages[0].elements[0]) {
        newData.pages[0].elements[0].id = `${modelName}_table_guid`;
      }
      
      // convert back to YAML
      const updatedYaml = yaml.dump(newData, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
        forceQuotes: false,
        quotingType: '"'
      });
      
      // write to sigma_model folder (sanitize to prevent path traversal)
      const sigmaModelPath = sanitizePath(`${modelName}.yml`, this.sigmaModelDir);
      fs.writeFileSync(sigmaModelPath, updatedYaml);
      
      console.log(`✓ Copied to sigma_model folder: ${sigmaModelPath}`);
      return sigmaModelPath;
      
    } catch (error) {
      console.error(`Error copying to sigma_model folder:`, error.message);
      throw error;
    }
  }

  /**
   * save data model spec from Sigma API to sigma_model folder as YAML
   * @param {Object} dataModelSpec - data model spec object from Sigma API
   * @param {string} modelName - name of the model
   * @returns {string} path to saved file
   */
  saveDataModelSpecToSigmaFolder(dataModelSpec, modelName) {
    try {
      const yaml = require('js-yaml');
      
      // convert data model spec to YAML
      const yamlContent = yaml.dump(dataModelSpec, {
        indent: 2,
        lineWidth: -1,
        noRefs: true,
        sortKeys: false,
        forceQuotes: false,
        quotingType: '"'
      });
      
      // write to sigma_model folder (sanitize to prevent path traversal)
      const sigmaModelPath = sanitizePath(`${modelName}.yml`, this.sigmaModelDir);
      fs.writeFileSync(sigmaModelPath, yamlContent);
      
      console.log(`✓ Saved data model spec to sigma_model folder: ${sigmaModelPath}`);
      return sigmaModelPath;
      
    } catch (error) {
      console.error(`Error saving data model spec to sigma_model folder:`, error.message);
      throw error;
    }
  }

  /**
   * save data model spec to sigma_model folder and commit it to git repository
   * @param {Object} dataModelSpec - data model spec object from Sigma API
   * @param {string} modelName - name of the model
   * @param {Object} options - optional commit options
   * @param {string} options.commitMessage - custom commit message (default: "Update data model: {modelName}")
   * @param {string} options.gitUser - git user name for commit (default: "CI Bot")
   * @param {string} options.gitEmail - git user email for commit (default: "ci-bot@example.com")
   * @returns {string} path to saved file
   */
  saveDataModelSpecInRepo(dataModelSpec, modelName) {

    // use spawnSync with array arguments - prevents command injection
    const { spawnSync } = require('child_process');
    
    try {
      // step 1: save the file to sigma_model folder
      const sigmaModelPath = this.saveDataModelSpecToSigmaFolder(dataModelSpec, modelName);
      
      // step 2: configure git user if not already set
      const gitUser = process.env.GIT_USER;
      const gitEmail = process.env.GIT_EMAIL;
      
      // Check if git user.name is set, if not, set it
      const userNameResult = spawnSync('git', ['config', 'user.name'], { stdio: 'ignore' });
      if (userNameResult.status !== 0) {
        spawnSync('git', ['config', 'user.name', gitUser], { stdio: 'ignore' });
        console.log(`  Configured git user.name: ${gitUser}`);
      }
      
      // Check if git user.email is set, if not, set it
      const userEmailResult = spawnSync('git', ['config', 'user.email'], { stdio: 'ignore' });
      if (userEmailResult.status !== 0) {
        spawnSync('git', ['config', 'user.email', gitEmail], { stdio: 'ignore' });
        console.log(`  Configured git user.email: ${gitEmail}`);
      }
      
      // step 3: get relative path from repository root for git add
      // if sigmaModelDir is absolute, we need to find the git root
      let gitRoot;
      try {
        const result = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
        if (result.error || result.status !== 0) {
          throw new Error('Not in a git repository. Cannot commit changes.');
        }
        gitRoot = result.stdout.toString().trim();
      } catch (error) {
        throw new Error('Not in a git repository. Cannot commit changes.');
      }
      
      // get relative path from git root
      const relativePath = path.relative(gitRoot, sigmaModelPath);
      
      // current working directory
      const originalCwd = process.cwd();
      
      try {
        // step 4: change to git root before executing git commands
        process.chdir(gitRoot);
        
        // step 5: add file to git staging area
        spawnSync('git', ['add', relativePath], { stdio: 'inherit' });
        console.log(`  ✓ Added to git staging: ${relativePath}`);
        
        // step 6: commit the file
        const commitMessage = `Committing update to Sigma data model: ${modelName}`;
        spawnSync('git', ['commit', '-m', commitMessage], { stdio: 'inherit' });
        console.log(`  ✓ Committed to git: ${commitMessage}`);
      } finally {
        // restore original working directory
        process.chdir(originalCwd);
      }
      
      return sigmaModelPath;
      
    } catch (error) {
      console.error(`Error saving data model spec to repository:`, error.message);
      throw error;
    }
  }

  /**
   * extract dataModelId from existing sigma model file if it exists
   * @param {string} modelName - name of the model
   * @returns {string|null} dataModelId if found, null otherwise
   */
  getExistingDataModelId(modelName) {
    // sanitize to prevent path traversal
    const sigmaModelPath = sanitizePath(`${modelName}.yml`, this.sigmaModelDir);
    
    if (!fs.existsSync(sigmaModelPath)) {
      return null;
    }
    
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(sigmaModelPath, 'utf8');
      const data = yaml.load(content);
      
      if (data.dataModelId) {
        console.log(`    Found existing dataModelId: ${data.dataModelId}`);
        return data.dataModelId;
      }
    } catch (error) {
      console.warn(`    Could not read existing sigma model file: ${error.message}`);
    }
    
    return null;
  }

  /**
   * Discover metrics from metrics-only sibling YAML files that reference
   * measures owned by the given semantic model.
   * @param {string} sourceFilePath - absolute path to the source YAML file
   * @param {string} modelName - name of the semantic model being processed
   * @param {Array} measures - measures defined in the semantic model
   * @returns {Array} external metrics that reference this model's measures
   */
  discoverExternalMetrics(sourceFilePath, modelName, measures) {
    const measureNames = new Set((measures || []).map(m => m.name));
    if (measureNames.size === 0) return [];

    const sourceDir = path.dirname(sourceFilePath);
    const resolved = path.resolve(sourceFilePath);
    const externalMetrics = [];

    try {
      const siblings = fs.readdirSync(sourceDir).filter(f =>
        (f.endsWith('.yml') || f.endsWith('.yaml')) &&
        path.resolve(path.join(sourceDir, f)) !== resolved
      );

      for (const sibling of siblings) {
        try {
          const data = yaml.load(fs.readFileSync(path.join(sourceDir, sibling), 'utf8'));
          // only metrics-only files (no semantic_models section)
          if (!data?.metrics || !Array.isArray(data.metrics) || data?.semantic_models) continue;

          for (const metric of data.metrics) {
            const refMeasure = metric.type_params?.measure;
            const refName = typeof refMeasure === 'string' ? refMeasure : refMeasure?.name;
            const refsInMetrics = (metric.type_params?.metrics || []).map(m =>
              typeof m === 'string' ? m : m.name
            );
            const allRefs = refName ? [refName, ...refsInMetrics] : refsInMetrics;
            if (allRefs.some(r => measureNames.has(r))) {
              externalMetrics.push(metric);
            }
          }
        } catch (e) {
          // skip unparseable files
        }
      }
    } catch (e) {
      // source directory not readable
    }

    if (externalMetrics.length > 0) {
      console.log(`    Found ${externalMetrics.length} external metrics for ${modelName}`);
    }
    return externalMetrics;
  }

  /**
   * process a single model in a layer
   * @param {Object} model - model information from DAG
   * @param {number} layerNumber - current layer number
   * @returns {Promise<Object>} processing result
   */
  async processDbtModel(model, layerNumber) {
    const { name, filePath, primaryEntity, foreignEntities } = model;
    
    console.log(`\n  Processing model: ${name} (Layer ${layerNumber})`);
    //console.log(`    Primary Entity: ${primaryEntity}`);
    //console.log(`    Foreign Entities: ${foreignEntities.join(', ') || 'None'}`);
    
    try {
      // construct file paths (sanitize to prevent path traversal)
      // source: use filePath from DAG (supports subdirectory structure)
      // output: flat structure (model name only)
      const sourceFilePath = sanitizePath(filePath, this.sourceDir);
      const outputFilePath = sanitizePath(`${name}.yml`, this.outputDir);
      
      // check if source file exists
      if (!fs.existsSync(sourceFilePath)) {
        throw new Error(`Source file not found: ${sourceFilePath}`);
      }

      // in update mode, check if model already exists and get its dataModelId
      let existingDataModelId = null;
      if (this.mode === 'update') {
        existingDataModelId = this.getExistingDataModelId(name);
      }

      // discover external metrics from metrics-only sibling files
      const sourceData = yaml.load(fs.readFileSync(sourceFilePath, 'utf8'));
      const semanticModel = sourceData.semantic_models?.find(m => m.name === name)
        || sourceData.semantic_models?.[0];
      const externalMetrics = this.discoverExternalMetrics(
        sourceFilePath, name, semanticModel?.measures
      );

      // prepare conversion options
      const conversionOptions = {
        outputDir: this.outputDir,
        manifestPath: this.manifestPath,
        connectionId: this.connectionId,
        tableName: primaryEntity,
        sigmaModelDir: this.sigmaModelDir,
        sigmaFolderId: this.sigmaFolderId,
        modelName: name,  // specify which semantic model to process from the file
        timeSpineFile: this.timeSpineFile,
        foreignEntities: foreignEntities,  // pass foreign entities from DAG
        externalMetrics: externalMetrics,   // metrics from metrics-only sibling files
        ...(existingDataModelId && { dataModelId: existingDataModelId })
      };
      
      // convert the semantic model
      console.log(`    Converting: ${sourceFilePath} -> ${outputFilePath} (model: ${name})`);
      const convertedData = convertSemantics(sourceFilePath, outputFilePath, conversionOptions);

      let sigmaModelId;
      let sigmaModelPath;
      
      if (process.env.TEST_FLAG === 'true') {
        
        if (this.mode === 'update' && existingDataModelId) {
          // update mode: use existing dataModelId (placeholder)
          sigmaModelId = existingDataModelId;
        } else {
          // initial mode: create new Sigma data model (placeholder)
          sigmaModelId = await this.createDummySigmaDataModel(name, convertedData);
        }
      
        // copy to sigma_model folder with GUID
        sigmaModelPath = this.generateIDsAndCopyModelToSigmaFolder(outputFilePath, name, sigmaModelId);

      } else {

        if (this.mode === 'update' && existingDataModelId) {
          // update mode: call Sigma API to update existing data model
          console.log(`    Updating existing data model: ${existingDataModelId}`);
          sigmaModelId = await updateDataModelInSigma(existingDataModelId, convertedData);
        } else {
          // initial mode: call Sigma API to create new data model
          console.log(`    Creating new data model`);
          sigmaModelId = await createDataModelInSigma(convertedData);
        }

        // call Sigma API to get data model
        const dataModelSpec = await getDataModelFromSigma(sigmaModelId);
        
        if (process.env.FROM_CI_CD === 'true') {
          // save data model as YAML to sigma_model folder
          sigmaModelPath = this.saveDataModelSpecInRepo(dataModelSpec, name);
        } else {
          // save data model as YAML to sigma_model folder
          sigmaModelPath = this.saveDataModelSpecToSigmaFolder(dataModelSpec, name);
        }

      }
      
      return {
        success: true,
        modelName: name,
        filePath: filePath,
        primaryEntity: primaryEntity,
        foreignEntities: foreignEntities,
        outputFilePath: outputFilePath,
        sigmaModelPath: sigmaModelPath,
        sigmaModelId: sigmaModelId
      };
      
    } catch (error) {
      console.error(`    ✗ Failed to process ${name}:`, error.message);
      return {
        success: false,
        modelName: name,
        filePath: filePath,
        primaryEntity: primaryEntity,
        error: error.message
      };
    }
  }

  /**
   * process all models in a layer
   * @param {Array} models - array of models in the layer
   * @param {number} layerNumber - current layer number
   * @returns {Promise<Array>} array of processing results
   */
  async processLayer(models, layerNumber) {
    console.log(`\n=== Processing Layer ${layerNumber} (${models.length} models) ===`);
    
    const results = [];
    
    for (const model of models) {
      const result = await this.processDbtModel(model, layerNumber);
      results.push(result);
    }
    
    // print layer summary
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    console.log(`\nLayer ${layerNumber} Summary:`);
    console.log(`  ✓ Successful: ${successful}`);
    console.log(`  ✗ Failed: ${failed}`);
    
    return results;
  }

  /**
   * load and parse DAG JSON file
   * @returns {Object} Parsed DAG data
   */
  loadDAG() {
    try {
      if (!fs.existsSync(this.dagFile)) {
        throw new Error(`DAG file not found: ${this.dagFile}`);
      }
      
      const dagContent = fs.readFileSync(this.dagFile, 'utf8');
      const dagData = JSON.parse(dagContent);
      
      console.log(`Loaded DAG with ${dagData.summary.totalModels} models in ${dagData.summary.totalLayers} layers`);
      
      return dagData;
      
    } catch (error) {
      console.error('Error loading DAG:', error.message);
      throw error;
    }
  }

  /**
   * Process all layers sequentially
   * @returns {Promise<Object>} Complete processing results
   */
  async processAllLayers() {
    console.log('Starting layer-by-layer processing...');
    
    // load DAG
    const dagData = this.loadDAG();
    
    const allResults = {
      layers: [],
      summary: {
        totalModels: dagData.summary.totalModels,
        processedModels: 0,
        successfulModels: 0,
        failedModels: 0,
        totalLayers: dagData.summary.totalLayers
      }
    };
    
    // track failed entity names across layers so dependent models can be skipped
    const failedEntityNames = new Set();

    // process each layer sequentially
    for (const layer of dagData.layers) {
      // filter out models whose foreign entities depend on a previously failed model
      const eligible = [];
      const skipped = [];
      for (const model of layer.models) {
        const deps = (model.foreignEntities || []).map(fe =>
          typeof fe === 'string' ? fe : fe.name
        );
        const blockedBy = deps.filter(d => failedEntityNames.has(d));
        if (blockedBy.length > 0) {
          console.warn(`  ⊘ Skipping ${model.name} — depends on failed: ${blockedBy.join(', ')}`);
          skipped.push({
            success: false,
            modelName: model.name,
            filePath: model.filePath,
            error: `Skipped: depends on failed entity(s) ${blockedBy.join(', ')}`
          });
        } else {
          eligible.push(model);
        }
      }

      const layerResults = await this.processLayer(eligible, layer.layer);

      // record failed models' primary entities so downstream layers can skip dependents
      for (const result of layerResults) {
        if (!result.success && result.primaryEntity) {
          failedEntityNames.add(result.primaryEntity);
        }
      }

      const combinedResults = [...layerResults, ...skipped];

      allResults.layers.push({
        layer: layer.layer,
        modelCount: layer.modelCount,
        results: combinedResults
      });

      // update summary
      allResults.summary.processedModels += combinedResults.length;
      allResults.summary.successfulModels += combinedResults.filter(r => r.success).length;
      allResults.summary.failedModels += combinedResults.filter(r => !r.success).length;
    }
    
    // print final summary
    console.log('\n=== PROCESSING COMPLETE ===');
    console.log(`Total Models: ${allResults.summary.totalModels}`);
    console.log(`Processed: ${allResults.summary.processedModels}`);
    console.log(`Successful: ${allResults.summary.successfulModels}`);
    console.log(`Failed: ${allResults.summary.failedModels}`);
    console.log(`Layers: ${allResults.summary.totalLayers}`);
    
    return allResults;
  }
}

module.exports = LayerProcessor;