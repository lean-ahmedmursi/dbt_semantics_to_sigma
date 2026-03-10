/**
 * converts SQL operators to Sigma-native syntax
 *
 * applied after CASE/CONCAT/SPLIT_PART conversion (identifiers are still bare)
 * but before convertColumnReferences (which wraps them in brackets)
 *
 * transformations:
 *   identifier IS NOT NULL  → isnotnull(identifier)
 *   identifier IS NULL      → isnull(identifier)
 *   identifier IS NOT TRUE  → identifier != True
 *   identifier IS NOT FALSE → identifier != False
 *   identifier IS TRUE      → identifier = True
 *   identifier IS FALSE     → identifier = False
 *   identifier NOT IN (…)   → not(arraycontains(array(…), identifier))
 *   identifier IN (…)       → arraycontains(array(…), identifier)
 *
 * @param {string} expr - expression with bare (un-bracketed) identifiers
 * @returns {string|null} converted expression, or null if no changes
 */
function convertSQLOperators(expr) {
  if (!expr || typeof expr !== 'string') {
    return null;
  }

  let converted = expr;

  // identifier pattern: bare SQL identifier (letters, digits, underscores)
  const id = '([a-zA-Z_][a-zA-Z0-9_]*)';

  // order matters — longer/more-specific patterns first to avoid partial matches

  // 1. IS NOT NULL → isnotnull(identifier)
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+NOT\\s+NULL', 'gi'),
    (_, col) => `isnotnull(${col})`
  );

  // 2. IS NULL → isnull(identifier)
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+NULL', 'gi'),
    (_, col) => `isnull(${col})`
  );

  // 3. IS NOT TRUE → != True
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+NOT\\s+TRUE', 'gi'),
    (_, col) => `${col} != True`
  );

  // 4. IS NOT FALSE → != False
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+NOT\\s+FALSE', 'gi'),
    (_, col) => `${col} != False`
  );

  // 5. IS TRUE → = True
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+TRUE', 'gi'),
    (_, col) => `${col} = True`
  );

  // 6. IS FALSE → = False
  converted = converted.replace(
    new RegExp(id + '\\s+IS\\s+FALSE', 'gi'),
    (_, col) => `${col} = False`
  );

  // 7. NOT IN (...) → not(arraycontains(array(...), identifier))
  converted = converted.replace(
    new RegExp(id + '\\s+NOT\\s+IN\\s*\\(([^)]+)\\)', 'gi'),
    (_, col, values) => `not(arraycontains(array(${values.trim()}), ${col}))`
  );

  // 8. IN (...) → arraycontains(array(...), identifier)
  converted = converted.replace(
    new RegExp(id + '\\s+IN\\s*\\(([^)]+)\\)', 'gi'),
    (_, col, values) => `arraycontains(array(${values.trim()}), ${col})`
  );

  return converted === expr ? null : converted;
}

module.exports = {
  convertSQLOperators
};
