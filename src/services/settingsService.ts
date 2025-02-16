import SettingsData from "../models/SettingsData";
import { ISettingsData } from "../models/SettingsData";

interface ISettingsService {
  apiUrl: string;
  getSettings(owner: string, repo: string, pull_number: number): Promise<SettingsData | null>;
}

export default class SettingsService implements ISettingsService {
  apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  async getSettings(owner: string, repo: string, pull_number: number): Promise<SettingsData | null> {
    const response = await fetch(`${this.apiUrl}?owner=${owner}&repo=${repo}&pull_number=${pull_number}`);
    if (!response.ok) return null;

    const settings = await response
      .json()
      .then((data) => new SettingsData(data as ISettingsData))
      .catch((error) => console.error(error));

    if (!settings) return null;
    return settings;
  }
}
