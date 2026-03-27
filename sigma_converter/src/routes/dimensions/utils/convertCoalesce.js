const { findMatchingClosingParen } = require('./findMatchingClosingParen');
const { parseFunctionArguments } = require('./parseFunctionArguments');

/**
 * converts COALESCE expressions to Sigma coalesce() syntax
 * @param {string} expr - expression containing COALESCE (e.g. COALESCE(col1, col2, col3))
 * @param {Function} convertExpressionToSigma - recursive function to convert nested expressions
 * @returns {string} Sigma formula (e.g., coalesce([Col1], [Col2], [Col3]))
 */
function convertCoalesce(expr, convertExpressionToSigma) {
  const coalesceMatch = expr.match(/coalesce\s*\(/i);
  if (!coalesceMatch) {
    return null;
  }

  const startPos = coalesceMatch.index + coalesceMatch[0].length;
  const endPos = findMatchingClosingParen(expr, startPos);
  if (endPos === -1) {
    return null;
  }

  const argsStr = expr.substring(startPos, endPos);
  const args = parseFunctionArguments(argsStr);

  // recursively convert each argument
  const convertedArgs = args.map(arg => {
    arg = arg.trim();
    // if it's a quoted string, keep as-is
    if ((arg.startsWith("'") && arg.endsWith("'")) ||
        (arg.startsWith('"') && arg.endsWith('"'))) {
      return arg;
    }
    return convertExpressionToSigma(arg);
  });

  // Sigma supports coalesce() natively with same syntax
  const result = `coalesce(${convertedArgs.join(', ')})`;

  return expr.substring(0, coalesceMatch.index) +
    result +
    expr.substring(endPos + 1);
}

module.exports = {
  convertCoalesce
};
