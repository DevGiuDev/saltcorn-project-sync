/**
 * API routes — assembles all route modules into a single array.
 */
const coreRoutes = require("./core");
const syncRoutes = require("./sync");
const gitRoutes = require("./git");
const branchRoutes = require("./branches");
const projectRoutes = require("./projects");
const deploymentRoutes = require("./deployments");
const deployUiRoutes = require("./deploy-ui");
const migrationRoutes = require("./migrations");

module.exports = [
  ...coreRoutes,
  ...syncRoutes,
  ...gitRoutes,
  ...branchRoutes,
  ...projectRoutes,
  ...deploymentRoutes,
  ...deployUiRoutes,
  ...migrationRoutes,
];
