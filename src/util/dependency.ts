import { dependency } from "../models/AnalysisOutput";

const filterDuplicatedDependencies = (dependencies: dependency[]) => {
  const uniqueDependencies: dependency[] = [];
  dependencies.forEach((dep) => {
    if (
      !uniqueDependencies.some(
        (d) =>
          d.body.interference[0].location.file === dep.body.interference[0].location.file &&
          d.body.interference[0].location.line === dep.body.interference[0].location.line &&
          d.body.interference[d.body.interference.length - 1].location.file ===
            dep.body.interference[dep.body.interference.length - 1].location.file &&
          d.body.interference[d.body.interference.length - 1].location.line ===
            dep.body.interference[dep.body.interference.length - 1].location.line
      )
    ) {
      uniqueDependencies.push(dep);
    }
  });

  return uniqueDependencies;
};

export { filterDuplicatedDependencies };
