// Test-only resolution aliases so App Router routes load under native Node ESM:
// - "next/server", "next/headers", ... are directory-style CJS specifiers Node
//   rejects; use the explicit CommonJS entry files instead.
// - "@/..." is the tsconfig path alias for "<repo>/src/...".
// - Sources import local modules extensionless (bundler-style); append .ts.
const srcRoot = new URL("../src/", import.meta.url);
const hasExtension = (specifier) => /\.\w+$/.test(specifier);

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("next/")) {
    return nextResolve(`${specifier}.js`, context);
  }
  if (specifier.startsWith("@/")) {
    const path = specifier.slice(2);
    const target = new URL(hasExtension(path) ? path : `${path}.ts`, srcRoot);
    return nextResolve(target.href, context);
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !hasExtension(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch {
      return nextResolve(`${specifier}.ts`, context);
    }
  }
  return nextResolve(specifier, context);
}
