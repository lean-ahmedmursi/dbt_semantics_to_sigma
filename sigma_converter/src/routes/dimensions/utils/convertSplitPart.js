const { findMatchingClosingParen } = require('./findMatchingClosingParen');
const { parseFunctionArguments } = require('./parseFunctionArguments');

/**
 * converts SPLIT_PART function to Sigma syntax
 * @param {string} expr - SPLIT_PART expression (e.g., SPLIT_PART(value, '@', 2))
 * @param {Function} convertExpressionToSigma - recursive function to convert nested expressions
 * @returns {string} Sigma formula (e.g., splitpart([value],'@',2))
 */
function convertSplitPart(expr, convertExpressionToSigma) {
  // check if this is a SPLIT_PART function call (case insensitive)
  const splitPartMatch = expr.match(/split_part\s*\(/i);
  if (!splitPartMatch) {
    return null;
  }

  // find the matching closing parenthesis
  const startPos = splitPartMatch.index + splitPartMatch[0].length;
  const endPos = findMatchingClosingParen(expr, startPos);
  if (endPos === -1) {
    return null;
  }

  // extracts the substring between the opening and closing parentheses
  const argsStr = expr.substring(startPos, endPos);
  const args = parseFunctionArguments(argsStr);

  // SPLIT_PART requires 3 arguments
  if (args.length < 3) {
    return null;
  }

  // convert first argument (may be a column reference or nested expression)
  // convertExpressionToSigma handles column refs internally
  const firstArg = convertExpressionToSigma(args[0].trim());
  // keep other arguments as-is (they're strings/numbers)
  const otherArgs = args.slice(1).map(arg => arg.trim());

  // build result: splitpart([column], 'delimiter', position)
  const result = `splitpart(${firstArg},${otherArgs.join(',')})`;
  
  // replace the original SPLIT_PART call
  return expr.substring(0, splitPartMatch.index) + 
         result + 
         expr.substring(endPos + 1);
}

module.exports = {
  convertSplitPart
};

