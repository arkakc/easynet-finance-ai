// Test runner only: Next.js's server-only marker is not a Node runtime module.
// Keep this shim outside application code; do not bypass the marker in production.
const Module = require("node:module");
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "server-only") return {};
  return load.apply(this, arguments);
};
