/**
 * Independent text normalization utilities.
 * Has zero external dependencies to prevent circular require warnings.
 */
function normalizeArabicText(text) {
  if (!text) return '';
  return text
    .replace(/[\u064B-\u0652\u0670]/g, '') // remove tashkeel (diacritics)
    .replace(/[إأآا]/g, 'ا')              // normalize alef variations
    .replace(/ة/g, 'ه')                    // normalize teh marbuta
    .replace(/ى/g, 'ي');                   // normalize alef maqsura
}

module.exports = { normalizeArabicText };
