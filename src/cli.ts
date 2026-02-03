import { parseArgs } from "jsr:@std/cli/parse-args";
import { parse as parseYaml } from "jsr:@std/yaml";
import { runOnce } from "./core/pipeline.ts";
import { startWebhookServer } from "./core/webhook.ts";

function usage(): void {
  console.log(
    `Traveler\n\nUsage:\n  deno task run -- <cmd> [--config path]\n\nCommands:\n  run      Fetch sources, select items, and write to Rote\n  webhook  Start a webhook listener to create notes from events\n\nOptions:\n  --config <path>   YAML config (default: configs/default.yaml)\n`,
  );
}

async function loadConfig(path: string): Promise<any> {
  const text = await Deno.readTextFile(path);
  return parseYaml(text) as any;
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, {
    boolean: ["help"],
    string: ["config"],
    alias: { h: "help" },
    default: { config: "configs/default.yaml" },
  });

  const cmd = args._[0] ? String(args._[0]) : "";
  if (args.help || !cmd) {
    usage();
    Deno.exit(0);
  }

  if (cmd === "run") {
    const cfg = await loadConfig(String(args.config));
    await runOnce(cfg);
    Deno.exit(0);
  } else if (cmd === "webhook") {
    const cfg = await loadConfig(String(args.config));
    if (cfg?.webhook?.enabled === false) {
      console.error("Webhook server disabled by config.");
      Deno.exit(1);
    }
    await startWebhookServer(cfg);
  } else {
    console.error(`Unknown command: ${cmd}`);
    usage();
    Deno.exit(1);
  }
}
