import { register } from "node:module";

// Native Node ESM cannot resolve the directory-style specifier "next/server"
// used by App Router routes; alias it to the explicit CommonJS entry file.
// Registered via --import so the hook is active before the test file loads.
register(new URL("./next-server-alias-loader.mjs", import.meta.url));
