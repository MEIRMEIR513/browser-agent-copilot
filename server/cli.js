import readline from "node:readline";
import { stdin, stdout } from "node:process";
import { AgentRun } from "./agent.js";
import { BrowserSession } from "./browser.js";
import { discoverModels, providers } from "./providers.js";

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function readSecret(question, rl) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    stdout.write("הערה: המפתח יוצג בזמן ההקלדה, כי הקלט הנוכחי אינו מסוף אינטראקטיבי.\n");
    return (await ask(rl, question)).trim();
  }
  rl.pause();
  stdout.write(question);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          rl.resume();
          stdout.write("\n");
          reject(new Error("ההפעלה בוטלה."));
          return;
        }
        if (byte === 13 || byte === 10) {
          stdin.off("data", onData);
          stdin.setRawMode(false);
          rl.resume();
          stdout.write("\n");
          resolve(value.trim());
          return;
        }
        if (byte === 127 || byte === 8) {
          value = value.slice(0, -1);
          continue;
        }
        if (byte >= 32 && byte <= 126) value += String.fromCharCode(byte);
      }
    };
    stdin.on("data", onData);
  });
}

async function chooseConfiguration(rl) {
  stdout.write("\nבחר ספק:\n");
  providers.forEach((provider, index) => stdout.write(`  ${index + 1}. ${provider.name}\n`));
  const providerAnswer = (await ask(rl, "מספר ספק: ")).trim();
  const provider = providers[Number(providerAnswer) - 1];
  if (!provider) throw new Error("בחירת הספק אינה תקינה.");

  stdout.write("Devin CLI חייב להיות מותקן ומאומת.\n");
  stdout.write("ודא שהרצת 'devin auth login' לפני השימוש.\n");
  stdout.write("ה-Free plan כולל גישה מוגבלת למודלים.\n");

  stdout.write("טוען רשימת מודלים...\n");
  const models = await discoverModels(provider.id, "");
  if (!models.length) throw new Error("לא נמצאו מודלים זמינים.");
  stdout.write("\nמודלים זמינים:\n");
  models.forEach((model, index) => {
    stdout.write(`  ${index + 1}. ${model.name}${model.vision ? " (תומך בתמונה)" : ""}\n`);
  });
  const modelAnswer = (await ask(rl, "מספר מודל: ")).trim();
  const model = models[Number(modelAnswer) - 1];
  if (!model) throw new Error("בחירת המודל אינה תקינה.");
  return { provider: provider.id, model: model.id, vision: model.vision, apiKey: "" };
}

async function main() {
  stdout.write("סוכן דפדפן — הפעלה מתוך הטרמינל\n");
  stdout.write("הסוכן משתמש בדפדפן Chromium נסתר; אין צורך לפתוח דפדפן או פורט.\n");
  const setup = readline.createInterface({ input: stdin, output: stdout });
  let config;
  try {
    config = await chooseConfiguration(setup);
  } finally {
    setup.close();
  }

  let rl;
  let run;
  let approvalId = null;
  const browser = new BrowserSession();
  const socket = {
    OPEN: 1,
    readyState: 1,
    send(raw) {
      const event = JSON.parse(raw);
      if (event.type === "message") stdout.write(`\nסוכן: ${event.content}\n`);
      if (event.type === "action") stdout.write(`\nמבצע: ${event.name} ${JSON.stringify(event.args)}\n`);
      if (event.type === "tool_result") stdout.write(`תוצאה: ${event.content}\n`);
      if (event.type === "error") stdout.write(`שגיאה: ${event.message}\n`);
      if (event.type === "status" && event.status === "working") stdout.write("הסוכן עובד...\n");
      if (event.type === "status" && event.status === "idle") stdout.write("\nמוכן להודעה נוספת.\n");
      if (event.type === "status" && event.status === "stopped") stdout.write("\nהפעולה נעצרה.\n");
      if (event.type === "approval_required") {
        approvalId = event.id;
        stdout.write(`\nנדרש אישור לפעולה: ${event.action}\nכדי לאשר כתוב "כן". לכל תשובה אחרת הפעולה תידחה.\n`);
      }
      if (event.type === "approval_resolved") approvalId = null;
      if (event.type === "browser_update") {
        if (event.warning) stdout.write(`אזהרה: ${event.warning}\n`);
        if (event.snapshot?.url) {
          stdout.write(`עמוד נוכחי: ${event.snapshot.title || "(ללא כותרת)"} — ${event.snapshot.url}\n`);
          const excerpt = event.snapshot.text?.trim().slice(0, 500);
          if (excerpt) stdout.write(`${excerpt}${event.snapshot.text.length > 500 ? "…" : ""}\n`);
        }
      }
    }
  };
  run = new AgentRun({ socket, browser, config });
  rl = readline.createInterface({ input: stdin, output: stdout, prompt: "\nאתה> " });
  stdout.write("\nכתוב משימה בשורה, או /עזרה להצגת פקודות.\n");
  rl.prompt();
  rl.on("line", (line) => {
    const text = line.trim();
    if (!text) {
      rl.prompt();
      return;
    }
    if (approvalId) {
      const accepted = ["כן", "כ", "y", "yes"].includes(text.toLowerCase());
      run.resolveApproval(approvalId, accepted);
      if (!accepted) stdout.write("הפעולה נדחתה.\n");
      rl.prompt();
      return;
    }
    if (["/יציאה", "/exit", "/quit"].includes(text.toLowerCase())) {
      run.stop();
      rl.close();
      return;
    }
    if (["/עצור", "/stop"].includes(text.toLowerCase())) {
      run.stop();
      rl.prompt();
      return;
    }
    if (["/עזרה", "/help"].includes(text.toLowerCase())) {
      stdout.write("כתוב משימה לסוכן. בזמן עבודה אפשר לשלוח הנחיה נוספת. /עצור מפסיק, /יציאה מסיימת.\n");
      rl.prompt();
      return;
    }
    if (run.running) {
      run.addUserMessage(text);
      stdout.write("קיבלתי, אעביר את ההנחיה לסוכן.\n");
      rl.prompt();
      return;
    }
    void run.run(text);
    rl.prompt();
  });

  const shutdown = async () => {
    run.stop();
    rl.close();
  };
  rl.on("close", () => {
    void browser.close().catch((error) => stdout.write(`לא ניתן לסגור את הדפדפן: ${error.message}\n`));
  });
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

main().catch((error) => {
  stdout.write(`\nלא ניתן להפעיל את הסוכן: ${error.message}\n`);
  process.exitCode = 1;
});
