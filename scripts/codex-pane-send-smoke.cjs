const fs = require("node:fs");
const path = require("node:path");
const { _electron: electron } = require("playwright");

async function main() {
  const outDir = path.join(process.cwd(), ".cache", "playwright-inspect");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "codex-pane-send-smoke.txt");
  const initialWaitMs = Number.parseInt(process.env.CODEX_PANE_SMOKE_INITIAL_WAIT_MS || "12000", 10);
  const afterSendWaitMs = Number.parseInt(process.env.CODEX_PANE_SMOKE_AFTER_SEND_WAIT_MS || "12000", 10);
  const app = await electron.launch({ args: ["."], cwd: process.cwd() });
  try {
    const win = await app.firstWindow();
    await win.waitForLoadState("domcontentloaded");
    await win.waitForTimeout(initialWaitMs);

    await app.evaluate(async ({ BaseWindow }) => {
      const child = BaseWindow.getAllWindows()[0].contentView.children[1];
      await child.webContents.executeJavaScript(
        `
          const input = document.getElementById("composerInput");
          const form = document.getElementById("composerForm");
          input.value = "Reply with exactly READY";
          form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        `,
        true,
      );
    });

    await win.waitForTimeout(afterSendWaitMs);

    const result = await app.evaluate(async ({ BaseWindow }) => {
      const child = BaseWindow.getAllWindows()[0].contentView.children[1];
      return child.webContents.executeJavaScript('document.body ? document.body.innerText : ""', true);
    });

    fs.writeFileSync(outPath, String(result || ""));
    console.log(outPath);
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
