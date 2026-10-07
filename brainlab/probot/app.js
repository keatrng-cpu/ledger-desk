/**
 * Probot variation of brain intake. From the repo root, after `npm install` in this folder
 * and a GitHub App private key:
 *   npx probot run ./brainlab/probot/app.js
 * The workflow `.github/workflows/brain-intake.yml` does this without the app. Run one of them, not both,
 * or the issue gets two comments.
 */
import { execFileSync } from "node:child_process";

export default (app) => {
  app.on("issues.opened", async (context) => {
    const title = context.payload.issue.title || "";
    const body = context.payload.issue.body || "";
    // `--title=…` form: an issue body that starts with "-" must not be read as another option. execFileSync takes an argv array, never a shell.
    const note = execFileSync("python3", ["brainlab/intake.py", `--title=${title}`, `--body=${body}`], {
      encoding: "utf8",
    });
    await context.octokit.issues.createComment(context.issue({ body: note }));
  });
};
