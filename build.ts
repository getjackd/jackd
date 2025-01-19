import esbuild from "esbuild"

// Then build bundles
await Promise.all([
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "esm",
    outfile: "dist/esm/index.js",
    target: "node18",
    platform: "node"
  }),
  esbuild.build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "cjs",
    outfile: "dist/cjs/index.js",
    target: "node18",
    platform: "node"
  })
])
