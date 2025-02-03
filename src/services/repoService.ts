interface IRepoService {
  apiUrl: string;
  isRepoRegistered(owner: string, repo: string): Promise<boolean>;
}

export default class RepoService implements IRepoService {
  apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = apiUrl;
  }

  async isRepoRegistered(owner: string, repo: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}?owner=${owner}&repo=${repo}`);
    return response.ok;
  }

  async registerRepo(owner: string, repo: string): Promise<boolean> {
    const response = await fetch(`${this.apiUrl}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ repo: { owner, repo } })
    });
    return response.ok;
  }
}
