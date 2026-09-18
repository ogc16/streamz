import { stitch } from "@google/stitch-sdk";

const { tools } = await stitch.listTools();
for (const tool of tools) {
  console.log(tool.name + " - " + tool.description.split("\n")[0]);
}
