export interface ISettingsData {
  uuid: string;
  repository: string;
  owner: string;
  pull_number: number;
  mainClass: string;
  mainMethod: string;
  baseClass?: string;
}

export default class SettingsData implements ISettingsData {
  uuid: string;
  repository: string;
  owner: string;
  pull_number: number;
  mainClass: string;
  mainMethod: string;
  baseClass?: string;

  constructor(settings: ISettingsData) {
    this.uuid = settings.uuid;
    this.repository = settings.repository;
    this.owner = settings.owner;
    this.pull_number = settings.pull_number;
    this.mainClass = settings.mainClass;
    this.mainMethod = settings.mainMethod;
    this.baseClass = settings.baseClass;
  }
}
