/**
 * Version of moonbit-registry-tools, from package.json (bundled into the binary)
 */

import pkg from "../package.json" with { type: "json" };

export const VERSION: string = pkg.version;
