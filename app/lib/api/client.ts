export class ApiRequestError extends Error {
  readonly status: number;

  constructor(message: string, status = 0) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
  }
}

const apiBaseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export async function apiGet<T>(path: string): Promise<T> {
  if (!apiBaseUrl) {
    throw new ApiRequestError("Java API base URL is not configured");
  }

  const response = await fetch(`${apiBaseUrl}/api/v1${path}`, {
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new ApiRequestError(`API request failed with status ${response.status}`, response.status);
  }

  return response.json() as Promise<T>;
}
