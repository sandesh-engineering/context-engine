import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ApiClientConfig } from './types';

export class ApiClient {
  public readonly http: AxiosInstance;
  private tenantId?: string;

  constructor(config: ApiClientConfig) {
    this.tenantId = config.tenantId;

    this.http = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeoutMs || 30000,
      headers: {
        'Content-Type': 'application/json',
        ...(config.tenantId ? { 'x-tenant-id': config.tenantId } : {}),
        ...(config.headers || {}),
      },
    });

    this.http.interceptors.request.use((reqConfig) => {
      if (this.tenantId && !reqConfig.headers['x-tenant-id']) {
        reqConfig.headers['x-tenant-id'] = this.tenantId;
      }
      return reqConfig;
    });
  }

  setTenantId(tenantId: string): void {
    this.tenantId = tenantId;
  }
}
