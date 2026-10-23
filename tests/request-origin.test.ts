import { describe, expect, it } from "vitest";
import { isTrustedOrigin } from "../apps/web/src/lib/session";

const ngrok = "https://1804-2402-8780-1018-20b-a059-c9fa-d6e3-9879.ngrok-free.app";

describe("isTrustedOrigin", () => {
  it("accepts the public host that forwarded the request", () => {
    const headers = new Headers({
      host: "127.0.0.1:3000",
      "x-forwarded-host": "1804-2402-8780-1018-20b-a059-c9fa-d6e3-9879.ngrok-free.app",
      "x-forwarded-proto": "https",
    });
    expect(isTrustedOrigin(headers, "http://127.0.0.1:3000/api/admin/sync", ngrok)).toBe(true);
  });

  it("rejects a different site posting to the public host", () => {
    const headers = new Headers({
      "x-forwarded-host": "1804-2402-8780-1018-20b-a059-c9fa-d6e3-9879.ngrok-free.app",
      "x-forwarded-proto": "https",
    });
    expect(isTrustedOrigin(headers, "http://127.0.0.1:3000/api/admin/sync", "https://evil.example")).toBe(false);
  });
});
