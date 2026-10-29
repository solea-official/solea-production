// Use the real Next Image component; Next's webpack resolves this CommonJS default
// interop automatically, while standalone esbuild browser fixtures need an alias.
export { Image as default } from "next/dist/client/image-component";
