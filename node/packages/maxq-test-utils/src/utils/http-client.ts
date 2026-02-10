/**
 * MaxQ Test HTTP Client
 *
 * Provides HTTP request helpers for integration testing.
 * Follows functional style - no classes.
 */

export type HttpResponse<T> = {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
};

export type TestHttpClient = {
  baseUrl: string;
  headers: Record<string, string>;
};

export function createTestHttpClient(
  baseUrl: string,
  options?: { headers?: Record<string, string> },
): TestHttpClient {
  return {
    baseUrl,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer test-token",
      ...options?.headers,
    },
  };
}

async function parseResponse<T>(response: Response): Promise<HttpResponse<T>> {
  const text = await response.text();

  // Try to parse as JSON, otherwise return text
  const data: T = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return text as T;
    }
  })();

  // Convert headers to plain object
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    data,
    status: response.status,
    statusText: response.statusText,
    headers,
  };
}

export async function httpRequest<T = unknown>(
  client: TestHttpClient,
  path: string,
  options?: RequestInit,
): Promise<HttpResponse<T>> {
  const url = `${client.baseUrl}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      ...client.headers,
      ...options?.headers,
    },
  });

  return parseResponse<T>(response);
}

export async function httpGet<T = unknown>(
  client: TestHttpClient,
  path: string,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(client, path, { method: "GET", headers });
}

export async function httpPost<T = unknown>(
  client: TestHttpClient,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(client, path, {
    method: "POST",
    body: body ? JSON.stringify(body) : undefined,
    headers,
  });
}

export async function httpPut<T = unknown>(
  client: TestHttpClient,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(client, path, {
    method: "PUT",
    body: body ? JSON.stringify(body) : undefined,
    headers,
  });
}

export async function httpPatch<T = unknown>(
  client: TestHttpClient,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(client, path, {
    method: "PATCH",
    body: body ? JSON.stringify(body) : undefined,
    headers,
  });
}

export async function httpDelete<T = unknown>(
  client: TestHttpClient,
  path: string,
  headers?: Record<string, string>,
): Promise<HttpResponse<T>> {
  return httpRequest<T>(client, path, { method: "DELETE", headers });
}

// Convenience functions for testing
export function setClientApiKey(client: TestHttpClient, apiKey: string): void {
  client.headers["Authorization"] = `Bearer ${apiKey}`;
}

export function setClientAuthHeader(
  client: TestHttpClient,
  value: string,
): void {
  client.headers["Authorization"] = value;
}

export function removeClientHeader(client: TestHttpClient, name: string): void {
  delete client.headers[name];
}
