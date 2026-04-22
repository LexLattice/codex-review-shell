import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { _electron as electron } from "playwright";

const appRoot = process.cwd();
const outDir = path.join(appRoot, ".cache", "playwright-inspect");
await fs.mkdir(outDir, { recursive: true });

const electronApp = await electron.launch({
  args: ["."],
  cwd: appRoot,
});

try {
  const window = await electronApp.firstWindow();
  await window.waitForLoadState("domcontentloaded");
  await window.waitForTimeout(2500);

  const title = await window.title();
  const url = window.url();
  const shellText = await window.locator("body").innerText().catch(() => "");
  const screenshotPath = path.join(outDir, "electron-shell.png");
  await window.screenshot({ path: screenshotPath, fullPage: true });

  let childTitles = [];
  try {
    childTitles = await electronApp.evaluate(async ({ BrowserWindow }) => {
      return BrowserWindow.getAllWindows().map((entry) => entry.getTitle());
    });
  } catch {}

  console.log(JSON.stringify({
    title,
    url,
    childTitles,
    screenshotPath,
    shellPreview: shellText.slice(0, 1200),
  }, null, 2));
} finally {
  await electronApp.close();
}
