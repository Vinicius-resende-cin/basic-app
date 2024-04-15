// Define the types of nodes for each analysis

type interferenceTypeList = {
  OA: {
    DECLARATION: "declaration";
    OVERRIDE: "override";
  };
  DEFAULT: {
    SOURCE: "source";
    SINK: "sink";
  };
};

type Flatten<T> = T extends object ? T[keyof T] : T;

type interferenceType = Flatten<Flatten<interferenceTypeList>>;

const interferenceTypes: interferenceTypeList = {
  OA: {
    DECLARATION: "declaration",
    OVERRIDE: "override"
  },
  DEFAULT: {
    SOURCE: "source",
    SINK: "sink"
  }
};

// Define the types of the analysis output

type lineLocation = {
  file: string;
  class: string;
  method: string;
  line: number;
};

type interferenceNode = {
  type: interferenceType;
  branch: "L" | "R";
  text: string;
  location: lineLocation;
  stackTrace?: Array<lineLocation>;
};

interface IAnalysisOutput {
  uuid: string;
  repository: string;
  owner: string;
  pull_number: number;
  data: {
    [key: string]: any;
  };
  events: Array<{
    type: string;
    label: string;
    body: {
      description: string;
      interference: Array<interferenceNode>;
    };
  }>;
}

class AnalysisOutput implements IAnalysisOutput {
  repository: string;
  owner: string;
  pull_number: number;
  uuid: string;
  data: { [key: string]: any };
  events: Array<{
    type: string;
    label: string;
    body: {
      description: string;
      interference: Array<interferenceNode>;
    };
  }>;

  constructor(analysisOutput: IAnalysisOutput) {
    this.uuid = analysisOutput.uuid;
    this.repository = analysisOutput.repository;
    this.owner = analysisOutput.owner;
    this.pull_number = analysisOutput.pull_number;
    this.data = analysisOutput.data;
    this.events = analysisOutput.events;
  }
}

export { IAnalysisOutput, AnalysisOutput, interferenceTypes };
