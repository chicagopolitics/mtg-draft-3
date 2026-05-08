/**
 * Allow `import x from "./file.wav"` syntax. The bundler (Turbopack /
 * webpack) copies the file into the build output and the import resolves
 * to a URL string.
 */
declare module "*.wav" {
  const url: string;
  export default url;
}

declare module "*.mp3" {
  const url: string;
  export default url;
}

declare module "*.ogg" {
  const url: string;
  export default url;
}
