import { IAnalysisOutput } from "../models/AnalysisOutput";

interface IAnalysisService {
  apiUrl: string;
  sendAnalysis(analysisOutput: IAnalysisOutput): Promise<void>;
}

export default class AnalysisService implements IAnalysisService {
  apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  async sendAnalysis(analysisOutput: IAnalysisOutput): Promise<void> {
    await fetch(this.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ analysis: analysisOutput })
    })
      .then((res) => console.log(res.text()))
      .catch((error) => console.log(error));
  }
}
