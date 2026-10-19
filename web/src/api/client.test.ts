import { describe, expect, it } from "vitest";

import { toApiError } from "./client";

describe("toApiError", () => {
  it("reads the server's error format", async () => {
    const response = new Response(
      JSON.stringify({ error: { code: "missing_api_key", message: "尚未配置 deepseek 的 API Key" } }),
      { status: 400 },
    );
    const error = await toApiError(response);
    expect([error.status, error.code, error.message]).toEqual([
      400,
      "missing_api_key",
      "尚未配置 deepseek 的 API Key",
    ]);
  });

  it("falls back for responses that are not ours", async () => {
    const error = await toApiError(new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect([error.status, error.code]).toEqual([502, "http_error"]);
  });
});
