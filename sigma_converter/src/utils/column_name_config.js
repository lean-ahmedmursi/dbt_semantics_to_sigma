const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { convertToUserFriendlyName } = require('../routes/dimensions/utils/convertToUserFriendlyName');

const useUserFriendlyNames = process.env.USER_FRIENDLY_COLUMN_NAMES === 'true';

/**
 * returns the user-friendly column name if the flag is enabled, otherwise the raw name
 * @param {string} name - raw column/dimension name
 * @returns {string} user-friendly or raw name
 */
function toDisplayName(name) {
  return useUserFriendlyNames ? convertToUserFriendlyName(name) : name;
}

module.exports = { useUserFriendlyNames, toDisplayName };
