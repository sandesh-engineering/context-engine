import { isAxiosError } from 'axios';

/**
 * Human-readable message for an API failure.
 *
 * @remarks
 * Prefers the backend's `{ message }` (Nest error body) over axios's generic
 * "Request failed with status code 400".
 */
export function getApiErrorMessage(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (isAxiosError(error)) {
    const message = (error.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message)) return message.join(', ');
    if (typeof message === 'string' && message) return message;
    if (!error.response) return 'Cannot reach the Knowledge Engine API. Check that the backend is running.';
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
