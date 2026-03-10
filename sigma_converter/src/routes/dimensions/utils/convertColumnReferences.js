const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
const { convertToUserFriendlyName } = require('./convertToUserFriendlyName');

// check if user-friendly column names are enabled (converts underscores to spaces)
// example: my_column → my column when flag is true
const userFriendlyColumnNameFlag = process.env.USER_FRIENDLY_COLUMN_NAMES;

/**
 * converts column references in an expression to Sigma format [column_name]
 * 
 * this function identifies SQL column references and converts them to Sigma's bracket notation, while skipping:
 * - SQL functions and keywords (e.g., CONCAT, CASE, WHEN)
 * - identifiers inside quoted strings (e.g., 'my_column')
 * - already bracketed references (e.g., [col1])
 * 
 * examples:
 *   input:  col1 + col2 * col3
 *   output: [col1] + [col2] * [col3]
 * 
 *   input:  concat(col1, col2)
 *   output: concat([col1], [col2])
 * 
 *   input:  col1 = 'my_column' AND col2 = 'value'
 *   output: [col1] = 'my_column' AND [col2] = 'value'
 * 
 *   input:  [col1] + col2
 *   output: [col1] + [col2]
 * 
 * @param {string} expr - expression string
 * @returns {string} expression with column references converted to [column_name] format
 */
function convertColumnReferences(expr) {

  // step 1: normalize whitespace
  // converts multiple spaces/tabs/newlines to single space and trims edges
  // example: col1   +  col2 → col1 + col2
  let converted = expr.replace(/\s+/g, ' ').trim();

  // step 2: pattern to match column references (identifiers)
  // matches: identifiers starting with letter/underscore, followed by letters/digits/underscores
  // uses word boundaries (\b) to avoid partial matches
  // examples that match: col1, my_column, _private, col123
  // examples that don't: 123col (starts with digit), col-name (contains hyphen)
  const columnRefPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
  
  // step 3: SQL functions and keywords that should NOT be converted to [function_name]
  // these are preserved as-is because they're SQL syntax, not column references
  // example: concat in concat(col1, col2) should remain concat, not [concat]
  const sigmaFunctions = new Set([
    'splitpart',
    'SUBSTRING', 'substring', 'SUBSTR', 'substr',
    'CONCAT', 'concat', 'CONCAT_WS', 'concat_ws',
    'UPPER', 'upper', 'LOWER', 'lower',
    'TRIM', 'trim', 'LTRIM', 'ltrim', 'RTRIM', 'rtrim',
    'COALESCE', 'coalesce', 'NULLIF', 'nullif',
    'CASE', 'case', 'WHEN', 'when', 'THEN', 'then', 'ELSE', 'else', 'END', 'end',
    'IF', 'if', 'AND', 'and', 'OR', 'or', 'NOT', 'not',
    'IS', 'is', 'NULL', 'null', 'TRUE', 'true', 'FALSE', 'false',
    'IN', 'in', 'BETWEEN', 'between', 'LIKE', 'like', 'EXISTS', 'exists',
    'DATE_TRUNC', 'date_trunc', 'DATE_PART', 'date_part',
    'EXTRACT', 'extract', 'TO_DATE', 'to_date', 'TO_TIMESTAMP', 'to_timestamp',
    'CAST', 'cast', '::'
  ]);

  // array to collect all replacements (we'll apply them later in reverse order)
  const replacements = [];
  let match;
  
  // step 4: find all potential column references using the regex pattern
  // the pattern uses the 'g' flag, so exec() will find all matches
  while ((match = columnRefPattern.exec(converted)) !== null) {
    const identifier = match[1];  // the matched identifier (e.g., "col1")
    const startPos = match.index; // starting position in the string
    const endPos = startPos + identifier.length; // ending position
    
    // step 4a: skip if it's a SQL function or keyword
    // example: concat in concat(col1, col2) should not become [concat]
    if (sigmaFunctions.has(identifier.toLowerCase())) {
      continue;
    }
    
    // step 4b: check if the identifier is inside a quoted string
    // we count quotes before the identifier to determine if we're inside a string
    // odd number of quotes = inside a string (skip conversion)
    // even number of quotes = outside a string (convert it)
    // example: col1 = 'my_column' → my_column is inside quotes, so skip it
    const before = converted.substring(0, startPos);
    const singleQuotesBefore = (before.match(/'/g) || []).length;
    const doubleQuotesBefore = (before.match(/"/g) || []).length;
    
    // if we're inside a string (odd quote count), skip this identifier
    if (singleQuotesBefore % 2 === 1 || doubleQuotesBefore % 2 === 1) {
      continue;
    }
    
    // step 4c: check if the identifier is already inside brackets [identifier]
    // this prevents double-bracketing: [col1] should not become [[col1]]
    // we check if there's a '[' before and a ']' after the identifier
    const beforeBrackets = before.lastIndexOf('[');
    const afterBrackets = converted.substring(endPos).indexOf(']');
    if (beforeBrackets !== -1 && afterBrackets !== -1 && 
        beforeBrackets < startPos && afterBrackets >= 0) {
      // already in brackets, skip it
      continue;
    }
    
    // step 4d: convert the column reference
    // apply user-friendly name conversion if enabled (underscores → spaces)
    // example: my_column → my column if USER_FRIENDLY_COLUMN_NAMES=true
    const userFriendlyName = userFriendlyColumnNameFlag === 'true' 
      ? convertToUserFriendlyName(identifier) 
      : identifier;
    
    // store the replacement for later (we'll apply all at once)
    replacements.push({
      start: startPos,
      end: endPos,
      replacement: `[${identifier}]`
    });
  }
  
  // step 5: apply all replacements in reverse order (right to left)
  // this is critical: applying from right to left preserves string positions
  // if we applied left to right, earlier replacements would shift positions of later ones
  // example: col1 + col2
  //   - col1 at position 0, col2 at position 7
  //   - apply col2 first (position 7) → col1 + [col2]
  //   - then apply col1 (position 0) → [col1] + [col2]
  replacements.sort((a, b) => b.start - a.start); // sort descending by start position
  for (const replacement of replacements) {
    converted = converted.substring(0, replacement.start) + 
                replacement.replacement + 
                converted.substring(replacement.end);
  }
  
  return converted;

}

module.exports = {
  convertColumnReferences
};

