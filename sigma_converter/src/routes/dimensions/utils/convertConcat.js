const { findMatchingClosingParen } = require('./findMatchingClosingParen');
const { parseFunctionArguments } = require('./parseFunctionArguments');

/**
 * converts CONCAT expressions to Sigma syntax
 * @param {string} expr - CONCAT expression (e.g. concat(stage_name, ' - ', stage_group))
 * @param {Function} convertExpressionToSigma - recursive function to convert nested expressions
 * @returns {string} Sigma formula (e.g., "stage_name & '-' & stage_group")
 */
function convertConcat(expr, convertExpressionToSigma) {
  // check if this is a CONCAT function call: concat(arg1, arg2, ...)
  const concatMatch = expr.match(/concat\s*\(/i);
  if (!concatMatch) {
    return null;
  }

  // find the matching closing parenthesis
  const startPos = concatMatch.index + concatMatch[0].length;
  const endPos = findMatchingClosingParen(expr, startPos);
  if (endPos === -1) {
    return null;
  }

  // extracts the substring between the opening and closing parentheses
  const argsStr = expr.substring(startPos, endPos);
  const args = parseFunctionArguments(argsStr);

  // convert each argument
  const convertedArgs = args.map(arg => {
    arg = arg.trim();
    // if it's a quoted string, keep it as-is (quotes are needed)
    if ((arg.startsWith("'") && arg.endsWith("'")) || 
        (arg.startsWith('"') && arg.endsWith('"'))) {
      return arg;
    }
    // recursively convert nested expressions (convertExpressionToSigma handles column refs)
    return convertExpressionToSigma(arg);
  });

  // join with &
  const result = convertedArgs.join(' & ');
  
  // replace the original CONCAT call
  return expr.substring(0, concatMatch.index) + 
    result + 
    expr.substring(endPos + 1);
}

module.exports = {
  convertConcat
};

