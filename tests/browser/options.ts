import { existsSync } from "node:fs";

const macChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const browserLaunchOptions = {
  executablePath: process.env.COUNCIL_CHROME ?? (existsSync(macChrome) ? macChrome : undefined),
  args: ["--no-sandbox"],
};
