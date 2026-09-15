export function processInvocationSizeMetrics(env: NodeJS.ProcessEnv, args: string[]) {
  const environmentEntries = Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string");
  const environmentSizes = environmentEntries.map(([key, value]) => Buffer.byteLength(`${key}=${value}\0`, "utf8"));
  return {
    argumentBytes: args.reduce((total, arg) => total + Buffer.byteLength(`${arg}\0`, "utf8"), 0),
    argumentCount: args.length,
    environmentBytes: environmentSizes.reduce((total, size) => total + size, 0),
    environmentVariableCount: environmentEntries.length,
    largestEnvironmentVariableBytes: environmentSizes.length ? Math.max(...environmentSizes) : 0,
  };
}
