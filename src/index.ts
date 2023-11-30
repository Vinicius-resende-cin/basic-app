import { Probot } from "probot";
import { exec } from "child_process";

function execute(command: string, callback: Function) {
  exec(command, function (_error, stdout, _stderr) {
    callback(stdout);
  });
}

export = (app: Probot) => {
  app.on("pull_request.opened", async (context) => {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const prNumber = context.payload.number;

    execute(
      `D: && cd D:/Arquivos/Documentos/IC/Repositorios/ferramentas de analise/conflict-static-analysis && mvn exec:java -D"exec.mainClass"="br.unb.cic.analysis.Main" -D"exec.args"="-csv target/annotations.csv -cp target/test-classes"`,
      async (output: string) => {
        console.log(output);
        const conflictsLine = output.match(/Number of conflicts:\s*([\d\.]*)\s*\n/);
        const nConflicts = conflictsLine ? conflictsLine[1] : "[ERROR]";
        const runtimeLine = output.match(/Total time:\s*([\d\.]*) s/);
        const runtime = runtimeLine ? runtimeLine[1] : "[ERROR]";

        const commentBody = `# Static Analysis Results
### Number of conflicts: ${nConflicts}
### Runtime: ${runtime} s`;

        await context.octokit.pulls.createReview({
          owner,
          repo,
          pull_number: prNumber,
          body: commentBody,
          comments: [],
          event: "COMMENT"
        });
      }
    );
  });
};
