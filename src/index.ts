import { Probot } from "probot";
import { exec } from "child_process";
import fs from "fs";
import util from "util";
const pexec = util.promisify(exec);

// Initialize probot app
export = (app: Probot) => {
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

    // Call the static-semantic-merge tool
    const mergerPath = "D:/Arquivos/Documentos/IC/Repositorios/static-semantic-merge/dependencies";
    const staticSemanticMergePath = `${mergerPath}/static-semantic-merge-1.0-SNAPSHOT.jar`;
    const gradlePath = "C:/Gradle/gradle-5.1.1/bin";
    const mavenPath = "D:/apache-maven-3.9.5/bin";

    console.log("Running static-semantic-merge...");

    try {
      const { stdout: analysis_output, stderr: analysis_error } = await pexec(
        `java -jar ${staticSemanticMergePath} ${merge_commit} ${left} ${right} ${merge_base} ${mergerPath} ${gradlePath} ${mavenPath}`
      );

      // Log the output and error
      console.log(analysis_output);
      console.log(analysis_error);
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
  });
};
