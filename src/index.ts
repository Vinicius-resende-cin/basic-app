import { Probot, Context } from "probot";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import util from "util";
import "dotenv/config";
import { v4 as uuidv4 } from "uuid";
import { IAnalysisOutput, dependency } from "./models/AnalysisOutput";
import { filterDuplicatedDependencies } from "./util/dependency";
import AnalysisService from "./services/analysisService";
import { PerformanceObserver } from "perf_hooks";
import RepoService from "./services/repoService";
import SettingsService from "./services/settingsService";
import { ISettingsData } from "./models/SettingsData";
const pexec = util.promisify(exec);

// Get the analysis API URL
const apiUrl = process.env.ANALYSIS_API;
if (!apiUrl) throw new Error("ANALYSIS_API is not set");
const analysisService = new AnalysisService(apiUrl);

// Get the repo API URL
const repoApiUrl = process.env.REPOS_API;
if (!repoApiUrl) throw new Error("REPOS_API is not set");
const repoService = new RepoService(repoApiUrl);

// Get the settings API URL
const settingsApiUrl = process.env.SETTINGS_API;
if (!settingsApiUrl) throw new Error("SETTINGS_API is not set");
const settingsService = new SettingsService(settingsApiUrl);

// Initialize probot app
export default (app: Probot) => {
  // Define a performance observer
  const perfObserver = new PerformanceObserver((items) => {
    items.getEntries().forEach((entry) => {
      app.log.debug(`[DEBUG] ${entry.name} took ${entry.duration} ms`);
    });
  });
  perfObserver.observe({ entryTypes: ["measure"], buffered: true });

  // Receives a webhook event for every installation
  app.on(["installation.created", "installation_repositories.added"], async (context) => {
    const installation = context.payload.installation.id;

    // get the repositories
    let repositories;
    if (context.name === "installation") {
      repositories = context.payload.repositories;
    } else if (context.name === "installation_repositories") {
      repositories = context.payload.repositories_added;
    }

    // Register the repositories
    if (!repositories) return context.log.info(`No repositories added for installation ${installation}`);
    for (let repository of repositories) {
      const [owner, repo] = repository.full_name.split("/");
      try {
        const response = await repoService.registerRepo(owner, repo);
        if (response) context.log.info(`Repository ${repository.full_name} registered`);
        else context.log.warn(`Repository ${repository.full_name} could not be registered`);
      } catch (error) {
        context.log.error(`Error registering repository ${repository.full_name}: ${error}`);
      }
    }
  });

  // Receives a webhook event for every opened pull request
  app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
    // Get owner, repo and pull number from the context
    const { owner, repo, pull_number } = context.pullRequest();

    //=================== Not valid if repo is not registered
    if (!(await repoService.isRepoRegistered(owner, repo))) return context.log.warn(`Repo ${repo} is not registered`);

    const getPR = async () => await context.octokit.pulls.get({ owner, repo, pull_number });
    let PR = await getPR();

    //=================== Not valid if the PR is closed or not mergeable
    let mergeable = PR.data.mergeable;
    for (let i = 0; !mergeable && i < 5; i++) {
      context.log.info("Waiting for mergeable status...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      PR = await getPR();
      mergeable = PR.data.mergeable;
    }
    if (!mergeable) return context.log.warn(`PR ${pull_number} from ${repo} is not open or not mergeable`);

    // Get the merge commit sha (awaits until the merge commit is created)
    startPerformance("wait_merge_commit");
    let merge_commit = PR.data.merge_commit_sha;
    for (let i = 0; !merge_commit && i < 5; i++) {
      context.log.info("Waiting for merge commit...");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      PR = await getPR();
      merge_commit = PR.data.merge_commit_sha;
    }
    endPerformance("wait_merge_commit");

    //=================== Not valid if no merge commit sha
    if (!merge_commit) throw new Error("No merge commit sha");

    // Get the parents of the merge commit
    const { parents } = (await context.octokit.repos.getCommit({ owner, repo, ref: merge_commit })).data;
    const left = parents[0].sha;
    const right = parents[1].sha;

    // Clone the repository
    context.log.info("Cloning repository...");
    startPerformance("clone_repository");
    if (fs.existsSync(repo)) fs.rmSync(repo, { recursive: true, force: true });
    await pexec(`git clone https://github.com/${owner}/${repo}`);
    process.chdir(repo);
    endPerformance("clone_repository");

    // Get the merge base of the parents
    let { stdout: merge_base } = await pexec(`git merge-base ${left} ${right}`);
    merge_base = merge_base.trim();

    //=================== Not valid if the merge base is the same as the left or right commit
    if (merge_base === left || merge_base === right) return context.log.warn("Merge base is the same as left or right");

    // Create a real merge commit on the local repository
    startPerformance("create_local_merge_commit");
    await pexec(`git checkout ${left}`);
    await pexec(`git merge ${right}`);
    merge_commit = (await pexec(`git rev-parse HEAD`)).stdout.trim();
    endPerformance("create_local_merge_commit");
    context.log.info(`Found all commits: (left)${left} (right)${right} (base)${merge_base} (merge)${merge_commit}`);

    // Execute the two-dott diff between the base commit and the merge commit
    startPerformance("git_diff");
    const { stdout: diffOutput } = await pexec(`git diff ${merge_base} ${merge_commit} -U10000`);
    endPerformance("git_diff");

    // Define the analysis parameters
    const dependenciesPath = process.env.MERGER_PATH;
    const staticSemanticMergePath = process.env.STATIC_SEMANTIC_MERGE_PATH;
    const gradlePath = process.env.GRADLE_PATH;
    const mavenPath = process.env.MAVEN_PATH;
    const scriptsPath = process.env.SCRIPTS_PATH;

    if (!dependenciesPath || !staticSemanticMergePath || !gradlePath || !mavenPath || !scriptsPath) {
      throw new Error("Environment variables not set");
    }

    // Get the pull request settings
    const settings = await settingsService.getSettings(owner, repo, pull_number);
    if (!settings) context.log.warn("Settings not found");

    try {
      // Execute the analysis
      startPerformance("analysis");
      await executeAnalysis(
        staticSemanticMergePath,
        merge_commit,
        left,
        right,
        merge_base,
        dependenciesPath,
        gradlePath,
        mavenPath,
        scriptsPath,
        context,
        settings ?? undefined
      );
      endPerformance("analysis");

      if (process.env.APP_ENV === "development") {
        // Copy the outputs to the data directory
        fs.mkdirSync(`../src/data/reports/${repo}/`, { recursive: true });
        fs.copyFileSync("out.txt", `../src/data/reports/${repo}/out.txt`);
        fs.copyFileSync("out.json", `../src/data/reports/${repo}/out.json`);
        fs.copyFileSync("./data/soot-results.csv", `../src/data/reports/${repo}/soot-results.csv`);
      }

      // get the JSON output
      let jsonOutput = JSON.parse(fs.readFileSync(`out.json`, "utf-8")) as dependency[];

      // adjust the paths of the files in the JSON output
      startPerformance("file_path_finding");
      jsonOutput.forEach((dependency) => {
        dependency.body.interference.forEach((interference) => {
          // Get the path of the Java file
          let javaFilePath = interference.location.class.replace(/\./g, "/") + ".java";
          javaFilePath = searchFile(".", javaFilePath, true, context) ?? "UNKNOWN";

          // Set the path of the Java file
          interference.location.file = javaFilePath;
        });
      });
      endPerformance("file_path_finding");

      // filter the duplicated dependencies
      const totalDependencies = jsonOutput.length;
      startPerformance("filter_duplicated_dependencies");
      jsonOutput = filterDuplicatedDependencies(jsonOutput);
      endPerformance("filter_duplicated_dependencies");
      context.log.info(`Filtered ${totalDependencies - jsonOutput.length} duplicated dependencies`);

      // Get the modified lines for each branch
      startPerformance("get_modified_lines");
      // Search for the modified-lines.txt file
      const modifiedLinesFile = searchFile("./files/project", "modified-lines.txt", true, context);

      // Get the modified methods from the file
      let modifiedLines = [];
      if (modifiedLinesFile) {
        const sections = fs.readFileSync(modifiedLinesFile, "utf-8").split("\n\n");

        for (let section of sections) {
          const lines = section.split("\n").map((line) => line.substring(line.indexOf(":") + 1).trim());
          if (lines.length < 5) {
            continue;
          }

          const className = lines[0];
          const fileName = className.split(".").pop() + ".java";
          modifiedLines.push({
            file: fileName,
            leftAdded: JSON.parse(lines[1]),
            leftRemoved: JSON.parse(lines[2]),
            rightAdded: JSON.parse(lines[3]),
            rightRemoved: JSON.parse(lines[4])
          });
        }
      }
      endPerformance("get_modified_lines");

      // search for all related files for each conflict
      let allFiles: string[] = [];
      startPerformance("search_related_files");
      jsonOutput.forEach((dependency) => {
        dependency.body.interference.forEach((interference) => {
          interference.stackTrace?.forEach((node) => {
            // get the java file from the class name
            let javaFilePath: string | null = node.class.replace(/\./g, "/") + ".java";

            // search for the file in the project directory
            javaFilePath = searchFile(".", javaFilePath, true, context);

            if (javaFilePath && !allFiles.includes(javaFilePath)) {
              // add the file to the list of files
              allFiles.push(javaFilePath);
            }
          });
        });
      });
      endPerformance("search_related_files");

      // remove related files that are already on the diff
      startPerformance("remove_related_files_from_diff");
      const diffFiles = diffOutput.split("\n").filter((line) => line.startsWith("diff --git a/"));
      const missingFilesPaths = allFiles.filter((file) => {
        return !diffFiles.some((diffFile) => diffFile.includes(file));
      });
      endPerformance("remove_related_files_from_diff");
      context.log.info(`Found ${missingFilesPaths.length} related files missing on diff`);

      // get the missing files content
      const missingFiles: { file: string; content: string }[] = [];
      startPerformance("get_missing_files_content");
      missingFilesPaths.forEach((file) => {
        const fileContent = fs.readFileSync(file, "utf-8");
        missingFiles.push({ file: file, content: fileContent });
      });
      endPerformance("get_missing_files_content");

      // Send the analysis results to the analysis server
      const analysisOutput: IAnalysisOutput = {
        uuid: uuidv4(),
        repository: repo,
        owner: owner,
        pull_number: pull_number,
        data: {
          modifiedLines: modifiedLines,
          missingFiles: missingFiles
        },
        diff: diffOutput,
        events: jsonOutput
      };
      await analysisService.sendAnalysis(analysisOutput);
    } catch (error) {
      context.log.error(`Error executing analysis: ${error}`);
    } finally {
      // Go back to the original directory and delete the cloned repository
      process.chdir("..");
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
};

async function executeAnalysis(
  staticSemanticMergePath: string,
  merge: string,
  left: string,
  right: string,
  base: string,
  dependenciesPath: string,
  gradlePath: string,
  mavenPath: string,
  scriptsPath: string,
  context: Context,
  settings?: ISettingsData
) {
  const cmd = [
    `java`,
    `-jar ${staticSemanticMergePath}`,
    `-hc ${merge}`,
    `-pc ${left} ${right}`,
    `-bc ${base}`,
    `-dp ${dependenciesPath}`,
    `-tpr ./`,
    `-gp ${gradlePath}`,
    `-mp ${mavenPath}`,
    `-sp ${scriptsPath}`
  ];

  if (settings) {
    cmd.push(`-cn "${settings.mainClass}"`);
    cmd.push(`-m "${settings.mainMethod}"`);
    if (settings.baseClass) cmd.push(`-ep "${settings.baseClass}"`);
  } else {
    cmd.push(`-cn org.example.Main`);
    cmd.push(`-m main`);
  }

  context.log.info("Running static-semantic-merge...");

  const { stdout: analysis_output, stderr: analysis_error } = await pexec(cmd.join(" "));

  // Log the output and error
  context.log.info(analysis_output);
  context.log.error(analysis_error);
}

function searchFile(source: string, filePath: string, recursive: boolean = false, context: Context): string | null {
  // Check if the file exists in the source directory
  const searchPath = path.join(source, filePath);
  if (fs.existsSync(searchPath)) return searchPath.replace(/\\/g, "/");
  if (!recursive) return null;

  // Get the subdirectories of the source directory
  try {
    const dirs = fs
      .readdirSync(source, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name);

    // Search the file in the subdirectories
    for (let dir of dirs) {
      const result = searchFile(path.join(source, dir), filePath, true, context);
      if (result) return result.replace(/\\/g, "/");
    }
  } catch (error) {
    context.log.error(`Error searching file: ${error}`);
    return null;
  }
  return null;
}

const startPerformance = (name: string) => {
  performance.mark(`start_${name}`);
};

const endPerformance = async (name: string) => {
  performance.mark(`end_${name}`);
  performance.measure(name, `start_${name}`, `end_${name}`);
};
