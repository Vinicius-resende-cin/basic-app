type analysisResult = "true" | "false" | "error";

type analysisResultList = {
  confluenceIntra: analysisResult;
  confluenceInter: analysisResult;
  leftRightOAIntra: analysisResult;
  rightLeftOAIntra: analysisResult;
  leftRightOAInter: analysisResult;
  rightLeftOAInter: analysisResult;
  leftRightPdgSdg: analysisResult;
  rightLeftPdgSdg: analysisResult;
  leftRightDfpInter: analysisResult;
  rightLeftDfpInter: analysisResult;
  leftRightPdgSdge: analysisResult;
  rightLeftPdgSdge: analysisResult;
};

type codeLine = {
  className: string;
  method: string;
  lineNumber: number;
};

type dependency = {
  from: codeLine;
  to: codeLine;
  stackTrace?: codeLine[];
};

type result = {
  analysis: analysisResultList;
  dependencies: dependency[];
};

interface IAnalysisOutput {
  repository: string;
  owner: string;
  pull_number: number;
  results: result[];
}

export { IAnalysisOutput };
