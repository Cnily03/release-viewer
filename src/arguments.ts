interface BuildOptions {
  buildBase: string;
  configPath: string;
  outDir: string;
}

export function parseBuildArgs(): BuildOptions & { restArgs: string[] } {
  const args = process.argv.slice(2);
  const options: BuildOptions = { buildBase: "", configPath: "", outDir: "" };
  const restArgs: string[] = [];

  while (args.length > 0) {
    const arg = args.shift()!;
    switch (arg) {
      case "--base": {
        const next = args.shift();
        if (!next) throw new Error(`Expected value after ${arg}`);
        options.buildBase = next;
        break;
      }
      case "-c":
      case "--config": {
        const next = args.shift();
        if (!next) throw new Error(`Expected value after ${arg}`);
        options.configPath = next;
        break;
      }
      case "-d":
      case "--out-dir": {
        const next = args.shift();
        if (!next) throw new Error(`Expected value after ${arg}`);
        options.outDir = next;
        break;
      }
      default:
        restArgs.push(arg!);
        break;
    }
  }

  return { ...options, restArgs };
}
