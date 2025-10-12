export interface HttpResponse<T> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
}

export class TestHttpClient {
  private baseUrl: string;
  private defaultHeaders: Record<string, string>;

  constructor(baseUrl: string, options?: { headers?: Record<string, string> }) {
    this.baseUrl = baseUrl;
    this.defaultHeaders = {
      "Content-Type": "application/json",
      // Default test Bearer token
      Authorization: "Bearer test-token",
      ...options?.headers,
    };
  }

  private async parseResponse<T>(response: Response): Promise<HttpResponse<T>> {
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

  async request<T = unknown>(
    path: string,
    options?: RequestInit,
  ): Promise<HttpResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        ...this.defaultHeaders,
        ...options?.headers,
      },
    });

    return this.parseResponse<T>(response);
  }

  async get<T = unknown>(
    path: string,
    headers?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { method: "GET", headers });
  }

  async post<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, {
      method: "POST",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  async put<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, {
      method: "PUT",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  async patch<T = unknown>(
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, {
      method: "PATCH",
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  async delete<T = unknown>(
    path: string,
    headers?: Record<string, string>,
  ): Promise<HttpResponse<T>> {
    return this.request<T>(path, { method: "DELETE", headers });
  }

  // Convenience methods for testing
  setApiKey(apiKey: string): void {
    this.defaultHeaders["Authorization"] = `Bearer ${apiKey}`;
  }

  setAuthHeader(value: string): void {
    this.defaultHeaders["Authorization"] = value;
  }

  removeHeader(name: string): void {
    delete this.defaultHeaders[name];
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }
}
