import { spawn } from "node:child_process";
import { PreprError } from "../core/errors.js";

export interface BrowserLaunch {
  command: string;
  args: string[];
}

export function browserLaunch(url: string, platform = process.platform): BrowserLaunch {
  if (platform === "darwin") return { command: "/usr/bin/open", args: [url] };
  if (platform === "win32") return { command: process.env.ComSpec ?? "cmd.exe", args: ["/d", "/s", "/c", "start", "", url] };
  return { command: "xdg-open", args: [url] };
}

export async function openBrowser(url: string): Promise<void> {
  const launch = browserLaunch(url);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(() => {
      child.unref();
      finish();
    }, 5_000);
    timer.unref();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    child.once("error", (error) => finish(new PreprError(`Unable to start browser launcher ${launch.command}: ${error.message}`, "BROWSER_LAUNCH_FAILED")));
    child.once("close", (code) => {
      if (code === 0) finish();
      else finish(new PreprError(`Browser launcher exited with status ${code}: ${stderr.trim() || "no error output"}`, "BROWSER_LAUNCH_FAILED"));
    });
  });
}
