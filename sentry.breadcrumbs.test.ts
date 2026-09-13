import { describe, expect, it } from "vitest";
import { stripBreadcrumbQuery } from "./sentry.breadcrumbs";

describe("stripBreadcrumbQuery (audit #274)", () => {
  it("tronque la query des fils d'Ariane http/fetch — la clé Google Books ou Comic Vine n'y est plus", () => {
    const stripped = stripBreadcrumbQuery({ category: "http", data: { url: "https://www.googleapis.com/books/v1/volumes?q=isbn:x&key=SECRET", method: "GET" } });
    expect(stripped.data?.url).toBe("https://www.googleapis.com/books/v1/volumes");
    expect(JSON.stringify(stripped)).not.toContain("SECRET");
    expect(stripped.data?.method).toBe("GET");
  });

  it("laisse intacts les autres fils d'Ariane et les URLs sans query", () => {
    const other = { category: "console", message: "x?y=SECRET" };
    expect(stripBreadcrumbQuery(other)).toBe(other);
    const plain = { category: "fetch", data: { url: "https://metron.cloud/api/issue/1/" } };
    expect(stripBreadcrumbQuery(plain)).toBe(plain);
  });
});
