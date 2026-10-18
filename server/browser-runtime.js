export function getBrowserRuntime(platform = process.platform, arch = process.arch) {
  if (platform === "linux" && arch === "x64") return "bundled-linux-x64";
  if (platform === "linux") return "unsupported-linux";
  return "playwright";
}
