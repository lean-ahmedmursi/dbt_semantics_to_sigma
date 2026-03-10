const { toDisplayName } = require('../../../utils/column_name_config');

// matches SQL identifiers: letters/digits/underscores starting with letter or underscore
const COLUMN_REF_RE = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

// SQL functions and keywords that should NOT be converted to [function_name]
// these are preserved as-is because they're SQL syntax, not column references
const SIGMA_FUNCTIONS = new Set([
  'splitpart',
  'substring', 'substr',
  'concat', 'concat_ws',
  'upper', 'lower',
  'trim', 'ltrim', 'rtrim',
  'coalesce', 'nullif',
  'case', 'when', 'then', 'else', 'end',
  'if', 'and', 'or', 'not',
  'is', 'null', 'true', 'false',
  'in', 'between', 'like', 'exists',
  'date_trunc', 'date_part',
  'extract', 'to_date', 'to_timestamp',
  'cast',
  'arraycontains', 'array', 'isnull', 'isnotnull'
]);

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

  // array to collect all replacements (we'll apply them later in reverse order)
  const replacements = [];

  // step 2: find all potential column references
  // matchAll returns a fresh iterator — safe to use a module-scope regex
  for (const match of converted.matchAll(COLUMN_REF_RE)) {
    const identifier = match[1];  // the matched identifier (e.g., "col1")
    const startPos = match.index; // starting position in the string
    const endPos = startPos + identifier.length; // ending position
    
    // step 4a: skip if it's a SQL function or keyword
    // example: concat in concat(col1, col2) should not become [concat]
    if (SIGMA_FUNCTIONS.has(identifier.toLowerCase())) {
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
    replacements.push({
      start: startPos,
      end: endPos,
      replacement: `[${toDisplayName(identifier)}]`
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

