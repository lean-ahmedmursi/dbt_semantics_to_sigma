const LayerProcessor = require('./routes/converter/layer_processor');
const { buildDAG, exportDAG } = require('./routes/converter/build_dag');

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const fs = require('fs');

/**
 * main execution script for layer-by-layer processing
 */
async function main() {
  console.log('=== DBT Semantic Layer Processor ===');
  console.log(`Mode: ${(process.env.MODE || 'unknown').toUpperCase()}`);
  console.log('Processing models layer by layer based on DAG\n');
  
  // configuration
  const config = {
    dagFile: process.env.DAG_FILE,
    manifestPath: process.env.SEMANTIC_MANIFEST_FILE,
    timeSpineFile: process.env.TIME_SPINE_FILE,
    sourceDir: process.env.SOURCE_DIR,
    outputDir: process.env.OUTPUT_DIR,
    sigmaModelDir: process.env.SIGMA_MODEL_DIR,
    sigmaFolderId: process.env.SIGMA_FOLDER_ID,
    connectionId: process.env.CONNECTION_ID,
    mode: process.env.MODE
  };

  let changedFiles = [];
  
  // override with command line arguments if provided for update mode
  // process.argv[0] = node executable, process.argv[1] = script path
  // so we need to slice from index 2 to get actual arguments
  if (config.mode === 'update' && process.argv.length > 2) {
    changedFiles = process.argv.slice(2);
  }
  
  // validate mode — accept 'auto' as alias that the workflow resolves before calling
  if (!['initial', 'update', 'auto'].includes(config.mode)) {
    throw new Error(`Invalid mode: ${config.mode}. Must be 'initial', 'update', or 'auto'`);
  }

  // update mode without specific files → process all models (full update)
  if (config.mode === 'update' && (!changedFiles || changedFiles.length === 0)) {
    console.log('Update mode with no changed files — processing all models');
  }
  
  console.log('Configuration:');
  console.log(`  Mode: ${config.mode}`);
  console.log(`  DAG File: ${config.dagFile}`);
  console.log(`  Manifest: ${config.manifestPath}`);
  console.log(`  Source Directory: ${config.sourceDir}`);
  console.log(`  Output Directory: ${config.outputDir}`);
  console.log(`  Sigma Model Directory: ${config.sigmaModelDir}`);
  console.log(`  Connection ID: ${config.connectionId}`);
  if (config.mode === 'update') {
    console.log(`  Changed Files: ${changedFiles.length}`);
    changedFiles.forEach(file => console.log(`    - ${file}`));
  }
  console.log();
  
  try {
    // step 1: build DAG
    console.log('=== Building DAG ===');
    let dagResults;
    if (config.mode === 'update') {
      // update mode: build DAG only for changed files
      const fullPaths = changedFiles.map(file => {
        // if file is relative, make it absolute relative to sourceDir
        if (!path.isAbsolute(file)) {
          return path.join(config.sourceDir, file);
        }
        return file;
      });
      dagResults = buildDAG(config.sourceDir, fullPaths);
    } else {
      // initial mode: build DAG for all files
      dagResults = buildDAG(config.sourceDir);
    }
    
    // export DAG to file
    exportDAG(dagResults, config.dagFile);
    console.log();
    
    // step 2: create processor instance
    const processor = new LayerProcessor(config);
    
    // step 3: process all layers
    const results = await processor.processAllLayers();
    
    // save results to file
    const resultsPath = path.join(config.outputDir, 'processing_results.json');
    require('fs').writeFileSync(resultsPath, JSON.stringify(results, null, 2));
    console.log(`\nProcessing results saved to: ${resultsPath}`);
    
    // print detailed results
    console.log('\n=== DETAILED RESULTS ===');
    results.layers.forEach(layer => {
      console.log(`\nLayer ${layer.layer}:`);
      layer.results.forEach(result => {
        if (result.success) {
          console.log(`  ✓ ${result.modelName} -> ${result.sigmaModelId}`);
        } else {
          console.log(`  ✗ ${result.modelName}: ${result.error}`);
        }
      });
    });
    
    console.log('\n=== PROCESSING COMPLETE ===');
    
  } catch (error) {
    console.error('Processing failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main };
