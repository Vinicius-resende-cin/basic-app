import { Probot } from "probot";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import util from "util";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { IAnalysisOutput, dependency } from "./models/AnalysisOutput";
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
    const { stdout: diffOutput } = await pexec(`git diff ${merge_base} ${merge_commit}`);
    console.log(diffOutput);

    // Call the static-semantic-merge tool
    const dependenciesPath = process.env.MERGER_PATH;
    const staticSemanticMergePath = process.env.STATIC_SEMANTIC_MERGE_PATH;
    const gradlePath = process.env.GRADLE_PATH;
    const mavenPath = process.env.MAVEN_PATH;
    const scriptsPath = process.env.SCRIPTS_PATH;

    const cmd = [
      `java`,
      `-jar ${staticSemanticMergePath}`,
      `-hc ${merge_commit}`,
      `-pc ${left} ${right}`,
      `-bc ${merge_base}`,
      `-dp ${dependenciesPath}`,
      `-tpr ./`,
      `-cn org.example.Main`,
      `-m main`,
      `-gp ${gradlePath}`,
      `-mp ${mavenPath}`,
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
      fs.copyFileSync("out.json", `../src/data/reports/${repo}/out.json`);
      fs.copyFileSync("./data/soot-results.csv", `../src/data/reports/${repo}/soot-results.csv`);
    } catch (error) {
      console.log(error);
    }

    // get the JSON output
    const jsonOutput = JSON.parse(fs.readFileSync(`out.json`, "utf-8")) as dependency[];

    // adjust the paths of the files in the JSON output
    const filePathFindingStart = performance.now();
    jsonOutput.forEach((dependency) => {
      dependency.body.interference.forEach((interference) => {
        // Get the path of the Java file
        let javaFilePath = interference.location.class.replace(".", "/") + ".java";
        javaFilePath = searchFile(".", javaFilePath, true) ?? "UNKNOWN";

        // Set the path of the Java file
        interference.location.file = javaFilePath;
      });
    });
    const filePathFindingEnd = performance.now();
    console.log(`File path finding took ${filePathFindingEnd - filePathFindingStart} ms`);

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
      uuid: uuidv4(),
      repository: repo,
      owner: owner,
      pull_number: pull_number,
      data: {},
      diff: diffOutput,
      events: jsonOutput
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

function searchFile(source: string, filePath: string, recursive: boolean = false): string | null {
  // Check if the file exists in the source directory
  const searchPath = path.join(source, filePath);
  if (fs.existsSync(searchPath)) return searchPath;
  if (!recursive) return null;

  // Get the subdirectories of the source directory
  const dirs = fs
    .readdirSync(source, { withFileTypes: true })
    .filter((dirent) => dirent.isDirectory())
    .map((dirent) => dirent.name);

  // Search the file in the subdirectories
  for (let dir of dirs) {
    const result = searchFile(path.join(source, dir), filePath, true);
    if (result) return result;
  }
  return null;
}
