// The public half of the beta signing key: it can CHECK license keys, never
// make them. Written by `npm run beta-key -- init` (the private half stays on
// the developer's PC). null = not set up yet: a packaged build then refuses to
// run, and `npm run release` refuses to build.
module.exports = null;
