/**
 * API routes — assembles all route modules into a single array.
 */
const coreRoutes = require("./core");
const syncRoutes = require("./sync");
const gitRoutes = require("./git");
const branchRoutes = require("./branches");
const projectRoutes = require("./projects");

module.exports = [
  ...coreRoutes,
  ...syncRoutes,
  ...gitRoutes,
  ...branchRoutes,
  ...projectRoutes,
];
