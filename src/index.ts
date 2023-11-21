import { Probot } from "probot";

export = (app: Probot) => {
  app.on("pull_request.opened", async (context) => {
    const owner = context.payload.repository.owner.login;
    const repo = context.payload.repository.name;
    const prNumber = context.payload.number;

    await context.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      body: "Anotação na linha 1!",
      comments: [{ path: "src/main/java/Text.java", position: 1, body: "Comentário na linha 1!" }],
      event: "COMMENT"
    });
  });
};
