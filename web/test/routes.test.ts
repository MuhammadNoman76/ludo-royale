import { beforeAll, describe, expect, it } from "vitest";

// The modules touch window/location when imported: give them the bare minimum.
beforeAll(() => {
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = { addEventListener() {}, chrome: undefined };
  g.location = { pathname: "/", hostname: "ludo.example.com", origin: "https://ludo.example.com" };
});

describe("client routes", () => {
  it("reads room and friend links", async () => {
    const { parseRoute, routePath } = await import("../src/router.js");
    expect(parseRoute("/r/abcd")).toEqual({ name: "room", code: "ABCD" });
    expect(parseRoute("/r/ABCD/")).toEqual({ name: "room", code: "ABCD" });
    expect(parseRoute("/r/AB1D")).toEqual({ name: "home" });
    expect(parseRoute("/r/IOOO")).toEqual({ name: "home" });
    expect(parseRoute("/f/ludo-7k3m-q9p2")).toEqual({ name: "friend", code: "LUDO-7K3M-Q9P2" });
    expect(parseRoute("/f/<script>")).toEqual({ name: "home" });
    expect(parseRoute("/solo")).toEqual({ name: "solo" });
    expect(parseRoute("/anything/else")).toEqual({ name: "home" });
    expect(routePath({ name: "room", code: "WXYZ" })).toBe("/r/WXYZ");
  });

  it("only accepts HTTPS game servers, or one on this computer", async () => {
    const { acceptableServer } = await import("../src/config.js");
    expect(acceptableServer("https://ludo.example.com/")).toBe("https://ludo.example.com");
    expect(acceptableServer("http://127.0.0.1:8787")).toBe("http://127.0.0.1:8787");
    expect(acceptableServer("http://localhost:8787/x")).toBe("http://localhost:8787");
    expect(acceptableServer("http://ludo.example.com")).toBeNull();
    expect(acceptableServer("https://user:pw@ludo.example.com")).toBeNull();
    expect(acceptableServer("javascript:alert(1)")).toBeNull();
    expect(acceptableServer("not a url")).toBeNull();
  });
});
