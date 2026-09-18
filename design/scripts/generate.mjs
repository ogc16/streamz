import "dotenv/config";
import { stitch } from "@google/stitch-sdk";

const prompt =
  process.argv[2] ??
  "A dark-mode video streaming app home screen called Streamz: genre tabs (Action, Comedy, Drama), a search bar, and a horizontal carousel of movie posters with play buttons. Mobile-first, high-contrast, purple accent (#7C4DFF).";

const projectId = process.env.STITCH_PROJECT_ID ?? "streamz-design";

const project = stitch.project(projectId);
let screen;
try {
  screen = await project.generate(prompt);
} catch (err) {
  console.error(
    "Failed to generate. Check STITCH_API_KEY in design/.env (see .env.example)."
  );
  console.error(String(err?.message ?? err).slice(0, 500));
  process.exit(1);
}

const htmlUrl = await screen.getHtml();
const imageUrl = await screen.getImage();
console.log("HTML:  " + htmlUrl);
console.log("IMAGE: " + imageUrl);
