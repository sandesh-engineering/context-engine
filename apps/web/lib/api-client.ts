import { createApiClient } from "@repo/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api/v1";

const DEFAULT_TENANT_ID =
  process.env.NEXT_PUBLIC_TENANT_ID || "00000000-0000-0000-0000-000000000001";

export const api = createApiClient({
  baseURL: API_BASE_URL,
  tenantId: DEFAULT_TENANT_ID,
});
