/**
 * Linear GraphQL API client.
 *
 * Thin wrapper around fetch() for Linear's GraphQL endpoint.
 * Handles authentication, request building, error parsing, and timeouts.
 */

const LINEAR_API = "https://api.linear.app/graphql";
const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Reads the Linear API key from environment.
 * Does NOT cache — reads process.env on every call so key rotation works without restart.
 */
export function getApiKey(): string {
  const key = process.env.LINEAR_API_KEY;
  if (!key) {
    throw new Error(
      "LINEAR_API_KEY environment variable not set. " +
        "Create a personal API key at https://linear.app/settings/api and run: " +
        "export LINEAR_API_KEY=lin_api_...",
    );
  }
  return key;
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: Record<string, unknown> }>;
}

/**
 * Generic GraphQL request to Linear API.
 * Returns typed data on success, throws on network or GraphQL errors.
 */
export async function graphqlRequest<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(LINEAR_API, {
      method: "POST",
      headers: {
        Authorization: getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new Error(
        "Invalid Linear API key. Check your LINEAR_API_KEY at https://linear.app/settings/api",
      );
    }

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after") ?? "unknown";
      throw new Error(`Linear API rate limited. Retry after ${retryAfter} seconds.`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "unknown error");
      throw new Error(`Linear API returned ${response.status}: ${body.slice(0, 500)}`);
    }

    const body = (await response.json()) as GraphQLResponse<T>;

    if (body.errors?.length) {
      const messages = body.errors.map((e) => e.message).join("; ");
      throw new Error(`Linear API error: ${messages}`);
    }

    if (body.data === undefined) {
      throw new Error("Linear API returned empty response");
    }

    return body.data;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Linear API request timed out after 10 seconds");
    }
    // Re-throw if already a formatted error
    if (err instanceof Error && err.message.startsWith("Linear")) {
      throw err;
    }
    if (err instanceof Error && err.message.startsWith("LINEAR_API_KEY")) {
      throw err;
    }
    throw new Error(
      `Failed to reach Linear API: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Strips control characters from text for safe terminal output.
 */
export function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}
