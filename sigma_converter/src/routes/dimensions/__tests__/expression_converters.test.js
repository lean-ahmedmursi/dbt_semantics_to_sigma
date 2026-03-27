/**
 * Unit tests for SQL → Sigma expression converters.
 *
 * Run: node src/routes/dimensions/__tests__/expression_converters.test.js
 */

const { convertExpressionToSigma } = require('../formula/build_sigma_formula');

let passed = 0;
let failed = 0;

function test(name, input, expected) {
  const result = convertExpressionToSigma(input);
  if (result === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  Input:    ${input}`);
    console.error(`  Expected: ${expected}`);
    console.error(`  Got:      ${result}`);
  }
}

function testEqual(name, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  Expected: ${expected}`);
    console.error(`  Got:      ${actual}`);
  }
}

function testIncludes(name, actual, substring) {
  if (actual && actual.includes(substring)) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  Expected to contain: ${substring}`);
    console.error(`  Got: ${actual}`);
  }
}

function testContains(name, input, substring) {
  const result = convertExpressionToSigma(input);
  if (result && result.includes(substring)) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL: ${name}`);
    console.error(`  Input:    ${input}`);
    console.error(`  Expected to contain: ${substring}`);
    console.error(`  Got: ${result}`);
  }
}

// =====================================================
// CASE expressions from KSA semantic models
// =====================================================

test(
  'CASE + IN with quoted strings (avs_type_group)',
  `CASE WHEN avs_type IN ('AVS_SARIE', 'AVS_PLUS', 'AVS_INTERNATIONAL') THEN 'AVS_NON_OB' ELSE avs_type END`,
  `if(arraycontains(array('AVS_SARIE', 'AVS_PLUS', 'AVS_INTERNATIONAL'), [avs_type]),'AVS_NON_OB',[avs_type])`
);

test(
  'CASE + COALESCE nested (verification_unique_accounts_checked)',
  `CASE WHEN m_successful_requests = 1 THEN COALESCE(iban_encrypted, account_id_hash_encrypted, entity_id) ELSE NULL END`,
  `if([m_successful_requests] = 1,coalesce([iban_encrypted], [account_id_hash_encrypted], [entity_id]),NULL)`
);

test(
  'CASE + IS TRUE/IS FALSE (is_async)',
  `CASE WHEN is_async IS TRUE THEN 'true' WHEN is_async IS FALSE THEN 'false' ELSE 'unknown' END`,
  `if([is_async] = True,'true',[is_async] = False,'false','unknown')`
);

test(
  'CASE + simple comparison + NULL',
  `CASE WHEN m_successful_requests = 1 THEN entity_id ELSE NULL END`,
  `if([m_successful_requests] = 1,[entity_id],NULL)`
);

test(
  'CASE + quoted string comparison (billing)',
  `CASE WHEN bill_type = 'AUTO' THEN product_consumption_revenue ELSE NULL END`,
  `if([bill_type] = 'AUTO',[product_consumption_revenue],NULL)`
);

test(
  'CASE + equality + no ELSE (active accounts)',
  `CASE WHEN entity_status = 'ACTIVE' THEN entity_id END`,
  `if([entity_status] = 'ACTIVE',[entity_id])`
);

test(
  'CASE + IS NOT NULL + no ELSE',
  `CASE WHEN lean_user_id IS NOT NULL THEN lean_user_id END`,
  `if(isnotnull([lean_user_id]),[lean_user_id])`
);

// =====================================================
// COALESCE standalone
// =====================================================

test(
  'COALESCE standalone with 3 args',
  `COALESCE(col_a, col_b, col_c)`,
  `coalesce([col_a], [col_b], [col_c])`
);

test(
  'COALESCE with 2 args',
  `COALESCE(national_id_hash, email_hash)`,
  `coalesce([national_id_hash], [email_hash])`
);

// =====================================================
// COALESCE edge cases
// =====================================================

test(
  'COALESCE with single arg',
  `COALESCE(col_a)`,
  `coalesce([col_a])`
);

test(
  'COALESCE with quoted string fallback',
  `COALESCE(col_a, 'unknown')`,
  `coalesce([col_a], 'unknown')`
);

test(
  'COALESCE with numeric fallback',
  `COALESCE(col_a, 0)`,
  `coalesce([col_a], 0)`
);

test(
  'COALESCE nested inside another expression (prefix + suffix preserved)',
  `some_col = COALESCE(a, b) AND other_col = 1`,
  `[some_col] = coalesce([a], [b]) AND [other_col] = 1`
);

// =====================================================
// CASE edge cases — column names with keywords
// =====================================================

testContains(
  'Column name containing "end" (weekend_flag)',
  `CASE WHEN weekend_flag = 1 THEN 'weekend' ELSE 'weekday' END`,
  '[weekend_flag]'
);

testContains(
  'Column name containing "case" (showcase_type)',
  `CASE WHEN showcase_type = 'A' THEN 1 ELSE 0 END`,
  '[showcase_type]'
);

testContains(
  'Column name containing "in" (main_category)',
  `CASE WHEN main_category = 'X' THEN 'yes' ELSE 'no' END`,
  '[main_category]'
);

testContains(
  'Column name containing "not" (notification_type)',
  `notification_type IS NOT NULL`,
  '[notification_type]'
);

// =====================================================
// CASE edge cases — multiple WHEN branches
// =====================================================

test(
  'CASE with 3 WHEN branches + ELSE',
  `CASE WHEN status = 'A' THEN 'active' WHEN status = 'I' THEN 'inactive' WHEN status = 'D' THEN 'deleted' ELSE 'unknown' END`,
  `if([status] = 'A','active',[status] = 'I','inactive',[status] = 'D','deleted','unknown')`
);

test(
  'CASE with numeric comparisons',
  `CASE WHEN score >= 90 THEN 'A' WHEN score >= 80 THEN 'B' WHEN score >= 70 THEN 'C' ELSE 'F' END`,
  `if([score] >= 90,'A',[score] >= 80,'B',[score] >= 70,'C','F')`
);

test(
  'CASE with AND in condition',
  `CASE WHEN status = 'ACTIVE' AND amount > 0 THEN 'valid' ELSE 'invalid' END`,
  `if([status] = 'ACTIVE' AND [amount] > 0,'valid','invalid')`
);

test(
  'CASE with OR in condition',
  `CASE WHEN type = 'A' OR type = 'B' THEN 'group1' ELSE 'group2' END`,
  `if([type] = 'A' OR [type] = 'B','group1','group2')`
);

// =====================================================
// CASE + nested functions
// =====================================================

test(
  'CASE with COALESCE in condition',
  `CASE WHEN COALESCE(status, 'UNKNOWN') = 'ACTIVE' THEN 1 ELSE 0 END`,
  `if(coalesce([status], 'UNKNOWN') = 'ACTIVE',1,0)`
);

test(
  'CASE with COALESCE in both condition and result',
  `CASE WHEN col_a IS NULL THEN COALESCE(col_b, col_c) ELSE col_a END`,
  `if(isnull([col_a]),coalesce([col_b], [col_c]),[col_a])`
);

test(
  'CASE with CONCAT in result',
  `CASE WHEN type = 'full' THEN CONCAT(first_name, ' ', last_name) ELSE first_name END`,
  `if([type] = 'full',[first_name] & ' ' & [last_name],[first_name])`
);

// =====================================================
// CASE + IN operator edge cases
// =====================================================

test(
  'CASE + NOT IN with quoted strings',
  `CASE WHEN status NOT IN ('DELETED', 'ARCHIVED') THEN 'active' ELSE 'removed' END`,
  `if(not(arraycontains(array('DELETED', 'ARCHIVED'), [status])),'active','removed')`
);

test(
  'CASE + IN with single value',
  `CASE WHEN type IN ('PERSONAL') THEN 'individual' ELSE 'other' END`,
  `if(arraycontains(array('PERSONAL'), [type]),'individual','other')`
);

// =====================================================
// IS TRUE / IS FALSE edge cases
// =====================================================

test(
  'IS TRUE standalone',
  `is_active IS TRUE`,
  `[is_active] = True`
);

test(
  'IS FALSE standalone',
  `is_deleted IS FALSE`,
  `[is_deleted] = False`
);

test(
  'IS NOT TRUE',
  `is_verified IS NOT TRUE`,
  `[is_verified] != True`
);

test(
  'IS NOT FALSE',
  `is_blocked IS NOT FALSE`,
  `[is_blocked] != False`
);

// =====================================================
// IS NULL / IS NOT NULL edge cases
// =====================================================

test(
  'IS NULL standalone',
  `col_name IS NULL`,
  `isnull([col_name])`
);

test(
  'IS NOT NULL standalone',
  `col_name IS NOT NULL`,
  `isnotnull([col_name])`
);

test(
  'IS NULL in CASE condition',
  `CASE WHEN parent_id IS NULL THEN 'root' ELSE 'child' END`,
  `if(isnull([parent_id]),'root','child')`
);

// =====================================================
// IN / NOT IN standalone
// =====================================================

test(
  'IN with quoted strings standalone',
  `status IN ('ACTIVE', 'PENDING')`,
  `arraycontains(array('ACTIVE', 'PENDING'), [status])`
);

test(
  'NOT IN with quoted strings standalone',
  `status NOT IN ('DELETED', 'EXPIRED')`,
  `not(arraycontains(array('DELETED', 'EXPIRED'), [status]))`
);

// =====================================================
// Simple column references
// =====================================================

test(
  'Simple column reference',
  `m_total_requests`,
  `[m_total_requests]`
);

test(
  'Column with underscores',
  `_airbyte_extracted_at`,
  `[_airbyte_extracted_at]`
);

// =====================================================
// CONCAT edge cases
// =====================================================

test(
  'CONCAT with 2 columns',
  `CONCAT(first_name, last_name)`,
  `[first_name] & [last_name]`
);

test(
  'CONCAT with string literal separator',
  `CONCAT(first_name, ' ', last_name)`,
  `[first_name] & ' ' & [last_name]`
);

test(
  'CONCAT with 4 args',
  `CONCAT(a, b, c, d)`,
  `[a] & [b] & [c] & [d]`
);

// =====================================================
// SPLIT_PART
// =====================================================

test(
  'SPLIT_PART basic',
  `SPLIT_PART(email, '@', 1)`,
  `splitpart([email],'@',1)`
);

test(
  'SPLIT_PART with column separator',
  `SPLIT_PART(full_path, '/', 2)`,
  `splitpart([full_path],'/',2)`
);

// =====================================================
// Nested CASE (CASE inside CASE)
// =====================================================

test(
  'Nested CASE in THEN branch',
  `CASE WHEN type = 'A' THEN CASE WHEN sub = 1 THEN 'A1' ELSE 'A_other' END ELSE 'B' END`,
  `if([type] = 'A',if([sub] = 1,'A1','A_other'),'B')`
);

// =====================================================
// Multiline / whitespace handling
// =====================================================

test(
  'Multiline CASE with extra whitespace',
  `CASE
    WHEN  status = 'ACTIVE'
    THEN  'yes'
    ELSE  'no'
   END`,
  `if([status] = 'ACTIVE','yes','no')`
);

test(
  'Tabs and mixed whitespace',
  `CASE\tWHEN\tstatus = 'X'\tTHEN\t1\tELSE\t0\tEND`,
  `if([status] = 'X',1,0)`
);

// =====================================================
// Complex real-world combinations
// =====================================================

test(
  'CASE + IS NOT NULL + COALESCE + no ELSE',
  `CASE WHEN entity_id IS NOT NULL THEN COALESCE(entity_id, account_id) END`,
  `if(isnotnull([entity_id]),coalesce([entity_id], [account_id]))`
);

test(
  'CASE + multiple conditions with IN and IS NULL',
  `CASE WHEN status IN ('A', 'B') THEN 'group1' WHEN status IS NULL THEN 'missing' ELSE 'other' END`,
  `if(arraycontains(array('A', 'B'), [status]),'group1',isnull([status]),'missing','other')`
);

// =====================================================
// FILTER CONVERTER
// =====================================================

const { convertFilterToSigma } = require('../../filter/filter_converter');

testEqual(
  'Filter: Dimension reference replacement',
  convertFilterToSigma("{{ Dimension('model__status') }} = 'ACTIVE'", 'model'),
  "[status] = 'ACTIVE'"
);

testEqual(
  'Filter: Dimension IN with quoted values',
  convertFilterToSigma("{{ Dimension('model__type') }} in ('A', 'B')", 'model'),
  "arraycontains(array('A', 'B'),[type])"
);

testEqual(
  'Filter: Dimension NOT IN',
  convertFilterToSigma("{{ Dimension('model__status') }} not in ('DELETED')", 'model'),
  "not(arraycontains(array('DELETED'),[status]))"
);

testEqual(
  'Filter: IS NULL',
  convertFilterToSigma("{{ Dimension('model__col') }} is null", 'model'),
  "isnull([col])"
);

testEqual(
  'Filter: IS NOT NULL',
  convertFilterToSigma("{{ Dimension('model__col') }} is not null", 'model'),
  "isnotnull([col])"
);

testEqual(
  'Filter: ILIKE pattern',
  convertFilterToSigma("{{ Dimension('model__name') }} ilike '%test%'", 'model'),
  "ilike([name],'%test%')"
);

testEqual(
  'Filter: NOT ILIKE pattern',
  convertFilterToSigma("{{ Dimension('model__name') }} not ilike '%spam%'", 'model'),
  "not(ilike([name],'%spam%'))"
);

testEqual(
  'Filter: Jinja braces removed',
  convertFilterToSigma("{{ Dimension('model__status') }} = 'X'", 'model'),
  "[status] = 'X'"
);

// =====================================================
// COLUMN REFERENCE EDGE CASES
// =====================================================

test(
  'Column ref: string literals not converted',
  `col_a = 'some_value'`,
  `[col_a] = 'some_value'`
);

test(
  'Column ref: already-bracketed refs not double-wrapped',
  `[col_a] = 1`,
  `[col_a] = 1`
);

test(
  'Column ref: SQL keywords not bracketed (NULL)',
  `CASE WHEN col IS NULL THEN NULL END`,
  `if(isnull([col]),NULL)`
);

test(
  'Column ref: number literals not bracketed',
  `col_a = 100`,
  `[col_a] = 100`
);

// =====================================================
// MEASURE FORMULA BUILDER
// =====================================================

const { buildMeasureFormula } = require('../../metrics/formula/build_formula_object');

testEqual(
  'Measure: simple column with sum',
  buildMeasureFormula({ agg: 'sum', expr: 'm_total_requests' }).formula,
  `sum([m_total_requests])`
);

testEqual(
  'Measure: simple column with count_distinct',
  buildMeasureFormula({ agg: 'count_distinct', expr: 'entity_id' }).formula,
  `countdistinct([entity_id])`
);

testEqual(
  'Measure: CASE expr with count_distinct (unique accounts)',
  buildMeasureFormula({
    agg: 'count_distinct',
    expr: "CASE WHEN m_successful_requests = 1 THEN COALESCE(iban_encrypted, account_id_hash_encrypted, entity_id) ELSE NULL END"
  }).formula,
  `countdistinct(if([m_successful_requests] = 1,coalesce([iban_encrypted], [account_id_hash_encrypted], [entity_id]),NULL))`
);

testEqual(
  'Measure: CASE expr with sum (billing revenue)',
  buildMeasureFormula({
    agg: 'sum',
    expr: "CASE WHEN bill_type = 'AUTO' THEN product_consumption_revenue ELSE NULL END"
  }).formula,
  `sum(if([bill_type] = 'AUTO',[product_consumption_revenue],NULL))`
);

testEqual(
  'Measure: CASE + IS NOT NULL with count_distinct (lean users)',
  buildMeasureFormula({
    agg: 'count_distinct',
    expr: "CASE WHEN lean_user_id IS NOT NULL THEN lean_user_id END"
  }).formula,
  `countdistinct(if(isnotnull([lean_user_id]),[lean_user_id]))`
);

testEqual(
  'Measure: CASE + equality with count_distinct (active accounts)',
  buildMeasureFormula({
    agg: 'count_distinct',
    expr: "CASE WHEN entity_status = 'ACTIVE' THEN entity_id END"
  }).formula,
  `countdistinct(if([entity_status] = 'ACTIVE',[entity_id]))`
);

testEqual(
  'Measure: avg aggregation',
  buildMeasureFormula({ agg: 'avg', expr: 'amount' }).formula,
  `avg([amount])`
);

testEqual(
  'Measure: min aggregation',
  buildMeasureFormula({ agg: 'min', expr: 'created_at' }).formula,
  `min([created_at])`
);

testEqual(
  'Measure: max aggregation',
  buildMeasureFormula({ agg: 'max', expr: 'updated_at' }).formula,
  `max([updated_at])`
);

testEqual(
  'Measure: count aggregation',
  buildMeasureFormula({ agg: 'count', expr: 'record_id' }).formula,
  `count([record_id])`
);

// Verify formula object structure
{
  const result = buildMeasureFormula({ agg: 'sum', expr: 'm_total_requests' });
  const checks = [
    ['aggFunc is sum', result.aggFunc === 'sum'],
    ['measureExpr preserved', result.measureExpr === 'm_total_requests'],
    ['existingFilter is null', result.existingFilter === null],
  ];
  checks.forEach(([name, ok]) => {
    if (ok) { passed++; } else { failed++; console.error(`FAIL: Measure structure - ${name}`); }
  });
}

// =====================================================
// METRIC CONVERTER (ratio, cumulative, derived)
// =====================================================

const { convertMetricToSigma } = require('../../metrics/metric_converter');

// Simulate a semantic model with measures (like verification_metrics)
const mockSemanticModel = {
  name: 'test_model',
  measures: [
    { name: 'total_requests', agg: 'sum', expr: 'm_total_requests', create_metric: true },
    { name: 'successful_requests', agg: 'sum', expr: 'm_successful_requests', create_metric: true },
    { name: 'failed_requests', agg: 'sum', expr: 'm_failed_requests', create_metric: true },
    { name: 'distinct_users', agg: 'count_distinct', expr: 'customer_id', create_metric: true },
  ],
  entities: [],
  dimensions: [],
};

// Pre-populate convertedMetrics as the converter would
const convertedMetrics = {};
mockSemanticModel.measures.forEach(m => {
  convertedMetrics[m.name] = buildMeasureFormula(m);
});

// Ratio metric
{
  const ratioMetric = {
    name: 'success_rate',
    label: 'Success Rate',
    type: 'ratio',
    type_params: {
      numerator: { name: 'successful_requests' },
      denominator: { name: 'total_requests' },
    },
  };
  const result = convertMetricToSigma(ratioMetric, mockSemanticModel, [ratioMetric], convertedMetrics);
  const checks = [
    ['ratio has formula', !!result.formula],
    ['ratio formula contains /', result.formula && result.formula.includes('/') ],
    ['ratio formula has numerator', result.formula && result.formula.includes('sum([m_successful_requests])')],
    ['ratio formula has denominator', result.formula && result.formula.includes('sum([m_total_requests])')],
    ['ratio uses raw name', result.name === 'success_rate'],
  ];
  checks.forEach(([name, ok]) => {
    if (ok) { passed++; } else { failed++; console.error(`FAIL: Ratio metric — ${name}. Got: ${result.formula}`); }
  });
}

// Cumulative metric
{
  const cumulativeMetric = {
    name: 'cumulative_users',
    label: 'Cumulative Users',
    type: 'cumulative',
    type_params: {
      measure: { name: 'distinct_users' },
    },
  };
  const result = convertMetricToSigma(cumulativeMetric, mockSemanticModel, [cumulativeMetric], convertedMetrics);
  const checks = [
    ['cumulative has formula', !!result.formula],
    ['cumulative formula uses measure', result.formula && result.formula.includes('countdistinct')],
    ['cumulative description has note', result.description && result.description.includes('Cumulative')],
    ['cumulative uses raw name', result.name === 'cumulative_users'],
  ];
  checks.forEach(([name, ok]) => {
    if (ok) { passed++; } else { failed++; console.error(`FAIL: Cumulative metric — ${name}. Got: ${JSON.stringify(result)}`); }
  });
}

// Derived metric with NULLIF
{
  const derivedMetric = {
    name: 'avg_per_user',
    label: 'Avg per User',
    type: 'derived',
    type_params: {
      expr: 'total_requests / NULLIF(distinct_users, 0)',
      metrics: [
        { name: 'total_requests' },
        { name: 'distinct_users' },
      ],
    },
  };
  const result = convertMetricToSigma(derivedMetric, mockSemanticModel, [derivedMetric], convertedMetrics);
  const checks = [
    ['derived has formula', !!result.formula],
    ['derived replaces NULLIF', result.formula && !result.formula.includes('NULLIF')],
    ['derived has if() for NULLIF', result.formula && result.formula.includes('if(')],
    ['derived uses raw name', result.name === 'avg_per_user'],
  ];
  checks.forEach(([name, ok]) => {
    if (ok) { passed++; } else { failed++; console.error(`FAIL: Derived metric — ${name}. Got: ${result.formula}`); }
  });
}

// Simple metric (explicit, not auto-created)
{
  const simpleMetric = {
    name: 'filtered_requests',
    label: 'Filtered Requests',
    type: 'simple',
    type_params: {
      measure: 'total_requests',
    },
  };
  const result = convertMetricToSigma(simpleMetric, mockSemanticModel, [simpleMetric], convertedMetrics);
  const checks = [
    ['simple has formula', !!result.formula],
    ['simple formula uses measure agg', result.formula && result.formula.includes('sum(')],
  ];
  checks.forEach(([name, ok]) => {
    if (ok) { passed++; } else { failed++; console.error(`FAIL: Simple metric — ${name}. Got: ${result.formula}`); }
  });
}

// =====================================================
// Summary
// =====================================================

console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
