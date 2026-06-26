import assert from "node:assert/strict";
import test from "node:test";
import { browserLaunch } from "../src/server/browser.js";

test("uses the absolute macOS browser launcher", () => {
  assert.deepEqual(browserLaunch("http://127.0.0.1:1234", "darwin"), {
    command: "/usr/bin/open",
    args: ["http://127.0.0.1:1234"]
  });
});

test("uses platform-specific browser launch arguments", () => {
  const windows = browserLaunch("http://127.0.0.1:1234", "win32");
  assert.match(windows.command, /cmd/i);
  assert.deepEqual(windows.args.slice(-2), ["", "http://127.0.0.1:1234"]);
  assert.deepEqual(browserLaunch("http://127.0.0.1:1234", "linux"), {
    command: "xdg-open",
    args: ["http://127.0.0.1:1234"]
  });
});
