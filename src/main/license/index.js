const path = require('path');
const { app } = require('electron');
const { makeLicense } = require('./license');
const PUBLIC_KEY = require('./public-key');

let license = null;

/** The app's license (checked in the packaged app, or with ATHAR_LICENSE=1 while developing). */
function getLicense() {
  if (!license) {
    license = makeLicense({
      storeFile: path.join(app.getPath('userData'), 'license.json'),
      publicKey: PUBLIC_KEY,
      required: app.isPackaged || process.env.ATHAR_LICENSE === '1'
    });
  }
  return license;
}

module.exports = { getLicense };
