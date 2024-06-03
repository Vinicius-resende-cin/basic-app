import { Probot } from "probot";
import { exec } from "child_process";
import fs from "fs";
import util from "util";
import "dotenv/config";
import { IAnalysisOutput, interferenceTypes, eventTypes } from "./models/AnalysisOutput";
const pexec = util.promisify(exec);

// Initialize probot app
export default (app: Probot) => {
  // Receives a webhook event for every opened pull request
  app.on("pull_request.opened", async (context) => {
    // Get owner, repo and pull number from the context
    const { owner, repo, pull_number } = context.pullRequest();

    // Get the merge commit sha (awaits until the merge commit is created)
    let merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
    for (let i = 0; !merge_commit && i < 5; i++) {
      console.log("Waiting for merge commit...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      merge_commit = (await context.octokit.pulls.get({ owner, repo, pull_number })).data.merge_commit_sha;
    }

    // If there is no merge commit, throw an error
    if (!merge_commit) throw new Error("No merge commit sha");
    console.log(merge_commit);

    // Get the parents of the merge commit
    const { parents } = (await context.octokit.repos.getCommit({ owner, repo, ref: merge_commit })).data;
    const left = parents[0].sha;
    const right = parents[1].sha;
    console.log(left, right);

    // Clone the repository
    if (fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });
    await pexec(`git clone https://github.com/${owner}/${repo}`);
    process.chdir(repo);

    // Get the merge base of the parents
    let { stdout: merge_base } = await pexec(`git merge-base ${left} ${right}`);
    merge_base = merge_base.trim();
    console.log(merge_base);

    // Create a real merge commit on the local repository
    await pexec(`git checkout ${left}`);
    await pexec(`git merge ${right}`);
    merge_commit = (await pexec(`git rev-parse HEAD`)).stdout.trim();

    // Execute the two-dott diff between the base commit and the merge commit
    const { stdout: diff_output } = await pexec(`git diff ${merge_base} ${merge_commit}`);
    console.log(diff_output);

    // Call the static-semantic-merge tool
    const mergerPath = process.env.MERGER_PATH;
    const staticSemanticMergePath = process.env.STATIC_SEMANTIC_MERGE_PATH;
    const gradlePath = process.env.GRADLE_PATH;
    const mavenPath = process.env.MAVEN_PATH;
    const scriptsPath = process.env.SCRIPTS_PATH;

    const cmd = [
      `java`,
      `-jar ${staticSemanticMergePath}`,
      `-h ${merge_commit}`,
      `-p ${left} ${right}`,
      `-b ${merge_base}`,
      `-ssm ${mergerPath}`,
      `-gp ${gradlePath}`,
      `-mvp ${mavenPath}`,
      `-mp ./`,
      `-sp ${scriptsPath}`
    ];

    console.log("Running static-semantic-merge...");

    try {
      const { stdout: analysis_output, stderr: analysis_error } = await pexec(cmd.join(" "));

      // Log the output and error
      console.log(analysis_output);
      console.log(analysis_error);
    } catch (error) {
      console.log(error);
    }

    // Copy the outputs to the data directory
    try {
      fs.mkdirSync(`../src/data/reports/${repo}/`, { recursive: true });
      fs.copyFileSync("out.txt", `../src/data/reports/${repo}/out.txt`);
      fs.copyFileSync("./data/soot-results.csv", `../src/data/reports/${repo}/soot-results.csv`);
    } catch (error) {
      console.log(error);
    }

    // Go back to the original directory and delete the cloned repository
    process.chdir("..");
    fs.rm(repo, { recursive: true, force: true }, (err) => {
      if (err) throw err;
    });

    // Create a review comment with the commit information
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

    // Send the analysis results to the analysis server
    const analysisOutput: IAnalysisOutput = {
      uuid: "661579e387487aec69fb6a4a",
      repository: repo,
      owner: owner,
      pull_number: pull_number,
      data: {},
      events: [
        {
          type: eventTypes.OA.INTRA.LR,
          label: "at samples.OverrideAssignmentVariable.conflict(OverrideAssignmentVariable.java:9)",
          body: {
            description: "OA conflict",
            interference: [
              {
                type: interferenceTypes.OA.DECLARATION,
                branch: "L",
                text: "int x = 1;",
                location: {
                  file: "src/main/java/samples/OverrideAssignmentVariable.java",
                  class: "samples.OverrideAssignmentVariable",
                  method: "conflict",
                  line: 5
                }
              },
              {
                type: interferenceTypes.OA.OVERRIDE,
                branch: "R",
                text: "x = 2;",
                location: {
                  file: "src/main/java/samples/OverrideAssignmentVariable.java",
                  class: "samples.OverrideAssignmentVariable",
                  method: "conflict",
                  line: 9
                }
              }
            ]
          }
        }
      ]
    };

    await fetch("http://localhost:4000/analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ analysis: analysisOutput })
    })
      .then((res) => console.log(res.text()))
      .catch((error) => console.log(error));
  });
};
