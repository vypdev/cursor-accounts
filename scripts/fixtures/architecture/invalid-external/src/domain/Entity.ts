const runtimeDependency = require('zod');

export const entity = runtimeDependency.object({ id: runtimeDependency.string() });
