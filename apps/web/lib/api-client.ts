import { createApiClient } from "@repo/api";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001/api/v1";

export const api = createApiClient({
  baseURL: API_BASE_URL,
});
