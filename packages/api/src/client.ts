import axios, { AxiosInstance } from 'axios';
import { ApiClientConfig } from './types';

export class ApiClient {
  public readonly http: AxiosInstance;

  constructor(config: ApiClientConfig) {
    this.http = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeoutMs || 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.headers || {}),
      },
    });
  }
}
