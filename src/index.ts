import { Probot } from "probot";
import { exec } from "child_process";
import fs from "fs";
import util from "util";
const pexec = util.promisify(exec);

export = (app: Probot) => {
  app.on("pull_request.opened", async (context) => {
    const { owner, repo, pull_number } = context.pullRequest();

    let merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
    for (let i = 0; !merge_commit && i < 5; i++) {
      console.log("Waiting for merge commit...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
    }

    if (!merge_commit) throw new Error("No merge commit sha");
    console.log(merge_commit);

    const { parents } = (await context.octokit.repos.getCommit({ owner, repo, ref: merge_commit })).data;
    const left = parents[0].sha;
    const right = parents[1].sha;
    console.log(left, right);

    if (fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });

    await pexec(`git clone https://github.com/${owner}/${repo}`);
    process.chdir(repo);
    const { stdout: merge_base } = await pexec(`git merge-base ${left} ${right}`);
    console.log(merge_base);

    process.chdir("..");
    fs.rm(repo, { recursive: true, force: true }, (err) => {
      if (err) throw err;
    });

    await context.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: pull_number,
      body: `Merge commit (não presente na árvore de commits): ${merge_commit}
Parents: ${left} ${right}
Merge base: ${merge_base}`,
      comments: [],
      event: "COMMENT"
    });
  });
};
