// Copyright (C) 2026 Makarious Robert
// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Independent text normalization utilities.
 * Has zero external dependencies to prevent circular require warnings.
 */
function normalizeArabicText(text) {
  if (!text) return '';
  return String(text)
    .replace(/[ً-ْٰ]/g, '') // remove tashkeel (diacritics)
    .replace(/ـ/g, '')                // remove tatweel (كـتـاب → كتاب)
    .replace(/[إأآا]/g, 'ا')              // normalize alef variations
    .replace(/ة/g, 'ه')                    // normalize teh marbuta
    .replace(/ى/g, 'ي')                    // normalize alef maqsura
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))  // Arabic-Indic digits → 0-9
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06F0)); // Persian digits → 0-9
}

module.exports = { normalizeArabicText };
