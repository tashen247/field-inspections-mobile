import type {
  ApiError as ApiErrorBody,
  AssignBody,
  CompleteUploadBody,
  CompleteUploadResponse,
  ConflictDetails,
  Inspection,
  InspectionDetail,
  ListInspectionsResponse,
  LoginResponse,
  RegisterDeviceBody,
  ReportResponse,
  ReviewBody,
  StartBody,
  StartResponse,
  StartUploadBody,
  StartUploadResponse,
  SubmissionBody,
  SubmissionResponse,
  TemplateListResponse,
  TokenPair,
  UserListResponse,
} from '@fim/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
  get code() {
    return this.body.code;
  }
  get conflict(): ConflictDetails | null {
    return this.body.code === 'VERSION_CONFLICT' ? (this.body.details as ConflictDetails) : null;
  }
  /** 4xx other than auth/rate-limit: retrying the same request will not help. */
  get permanent() {
    return this.status >= 400 && this.status < 500 && this.status !== 401 && this.status !== 429;
  }
}

/** The request never got an HTTP response (offline, DNS, timeout). Always safe to retry. */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Network request failed');
    this.name = 'NetworkError';
  }
}

export interface TokenStore {
  get(): { accessToken: string; refreshToken: string } | null;
  set(tokens: TokenPair): void | Promise<void>;
  /** Refresh failed: the session is over. */
  clear(): void | Promise<void>;
}

export interface ApiClientOptions {
  baseUrl: string;
  tokens: TokenStore;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(opts: ApiClientOptions) {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  let refreshing: Promise<boolean> | null = null;

  async function raw(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
    if (init.auth !== false) {
      const t = opts.tokens.get();
      if (t) headers.set('authorization', `Bearer ${t.accessToken}`);
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(`${opts.baseUrl}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      throw new NetworkError(err);
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh(): Promise<boolean> {
    const t = opts.tokens.get();
    if (!t) return false;
    const res = await raw('/v1/auth/refresh', {
      method: 'POST',
      auth: false,
      body: JSON.stringify({ refreshToken: t.refreshToken }),
    });
    if (!res.ok) {
      if (res.status === 401) await opts.tokens.clear();
      return false;
    }
    await opts.tokens.set((await res.json()) as TokenPair);
    return true;
  }

  async function request<T>(
    path: string,
    init: RequestInit & { auth?: boolean } = {},
    retried = false,
  ): Promise<T> {
    const res = await raw(path, init);
    if (res.status === 401 && init.auth !== false && !retried) {
      // One refresh at a time, however many requests hit an expired token together.
      refreshing ??= refresh().finally(() => {
        refreshing = null;
      });
      if (await refreshing) return request<T>(path, init, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const body = (json as ApiErrorBody | undefined) ?? {
        code: 'INTERNAL',
        message: `HTTP ${res.status}`,
      };
      throw new ApiError(res.status, body);
    }
    return json as T;
  }

  const post = <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body), headers });

  return {
    login: (email: string, password: string) =>
      request<LoginResponse>('/v1/auth/login', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email, password }),
      }),
    templates: () => request<TemplateListResponse>('/v1/templates'),
    listInspections: (q: {
      since?: string | null;
      cursor?: string | null;
      status?: string;
      mine?: boolean;
    }) => {
      const params = new URLSearchParams();
      if (q.mine) params.set('assignedTo', 'me');
      if (q.since) params.set('since', q.since);
      if (q.cursor) params.set('cursor', q.cursor);
      if (q.status) params.set('status', q.status);
      params.set('limit', '200');
      return request<ListInspectionsResponse>(`/v1/inspections?${params.toString()}`);
    },
    detail: (id: string) => request<InspectionDetail>(`/v1/inspections/${id}`),
    start: (id: string, body: StartBody) =>
      post<StartResponse>(`/v1/inspections/${id}/start`, body),
    submit: (id: string, body: SubmissionBody, idempotencyKey: string) =>
      request<SubmissionResponse>(`/v1/inspections/${id}/submission`, {
        method: 'PUT',
        body: JSON.stringify(body),
        headers: { 'idempotency-key': idempotencyKey },
      }),
    startUpload: (id: string, body: StartUploadBody) =>
      post<StartUploadResponse>(`/v1/inspections/${id}/photos/upload`, body),
    completeUpload: (id: string, body: CompleteUploadBody) =>
      post<CompleteUploadResponse>(`/v1/inspections/${id}/photos/complete`, body),
    review: (id: string, body: ReviewBody) =>
      request<Inspection>(`/v1/inspections/${id}/review`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    assign: (id: string, body: AssignBody) =>
      request<Inspection>(`/v1/inspections/${id}/assign`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    assessors: () => request<UserListResponse>('/v1/users?role=assessor'),
    report: (id: string) => request<ReportResponse>(`/v1/inspections/${id}/report`),
    registerDevice: (body: RegisterDeviceBody) => post<void>('/v1/devices', body),
  };
}
