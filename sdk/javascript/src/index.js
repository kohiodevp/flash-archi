// sdk/javascript/src/index.js
export class FlashArchiError extends Error {
  constructor(status, body) {
    super(body.message || body.error || 'API Error');
    this.name = 'FlashArchiError';
    this.status = status;
    this.body = body;
  }
}

export class FlashArchiClient {
  /**
   * @param {{ apiKey: string, baseUrl?: string }} opts
   *   apiKey: Clé API publique (Bearer) avec scopes public:*
   *   baseUrl: URL de base de l'API publique (défaut: même origine)
   */
  constructor({ apiKey, baseUrl = '' }) {
    if (!apiKey) throw new Error('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  /** Envoie une requête HTTP vers l'API publique. */
  async _request(method, path, body = null) {
    const url = `${this.baseUrl}${path}`;
    const headers = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    const options = { method, headers };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    // Si la réponse n'est pas JSON (ex. 204), on renvoie null.
    if (response.status === 204) return null;

    let data;
    try {
      data = await response.json();
    } catch (_) {
      // Pas de corps JSON (ex. 204 déjà traité ci-dessus, ou erreur serveur non-JSON)
      data = {};
    }

    if (!response.ok) {
      throw new FlashArchiError(response.status, data);
    }
    return data;
  }

  // ====================== PROJETS ======================
  /** GET /projects */
  async listProjects({ limit = 20, offset = 0 } = {}) {
    return this._request('GET', `/projects?limit=${limit}&offset=${offset}`);
  }

  /** POST /projects */
  async createProject(data) {
    // data: { name, prompt, parameters? }
    return this._request('POST', '/projects', data);
  }

  /** GET /projects/{projectId} */
  async getProject(projectId) {
    return this._request('GET', `/projects/${projectId}`);
  }

  /** PATCH /projects/{projectId} */
  async updateProject(projectId, data) {
    return this._request('PATCH', `/projects/${projectId}`, data);
  }

  /** DELETE /projects/{projectId} */
  async deleteProject(projectId) {
    return this._request('DELETE', `/projects/${projectId}`);
  }

  // ====================== JOBS ======================
  /** POST /projects/{projectId}/jobs */
  async createJob(projectId, data = {}) {
    // data: { prompt }
    return this._request('POST', `/projects/${projectId}/jobs`, data);
  }

  /** GET /jobs/{jobId} */
  async getJob(jobId) {
    return this._request('GET', `/jobs/${jobId}`);
  }

  /** GET /jobs/{jobId}/artifacts */
  async listArtifacts(jobId) {
    return this._request('GET', `/jobs/${jobId}/artifacts`);
  }

  // ====================== WEBHOOKS ======================
  /** POST /webhooks */
  async createWebhook(data) {
    // data: { url, events: [...] }
    return this._request('POST', '/webhooks', data);
  }

  /** GET /webhooks */
  async listWebhooks() {
    return this._request('GET', '/webhooks');
  }

  /** DELETE /webhooks/{webhookId} */
  async deleteWebhook(webhookId) {
    return this._request('DELETE', `/webhooks/${webhookId}`);
  }
}