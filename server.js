// server.js -- robust wrapper to run index.js with hourly restart + crash-restart/backoff
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const APP_FILE = "index.js";         
const CWD = path.join(__dirname); 
const HOURLY_RESTART_MS = 60 * 60 * 1000; 
const RESTART_DELAY_MS = 5000;       
const MAX_BACKOFF_MS = 60 * 1000;  

let bot = null;
let hourlyTimer = null;
let backoff = RESTART_DELAY_MS;

function spawnBot() {
  console.log(`[wrapper] Spawning node ${APP_FILE} (cwd=${CWD})`);
  bot = spawn(process.execPath, [APP_FILE], {
    cwd: CWD,
    stdio: "inherit",
    env: process.env,
  });
  bot.once("error", (err) => {
    console.error("[wrapper] child process error:", err && err.stack ? err.stack : err);
  });
  bot.once("close", (code, signal) => {
    console.log(`[wrapper] child closed. code=${code} signal=${signal}`);
    scheduleRestart();
  });
  backoff = RESTART_DELAY_MS;
}

function scheduleRestart() {
  const delay = Math.min(backoff, MAX_BACKOFF_MS);
  console.log(`[wrapper] scheduling restart in ${delay}ms`);
  setTimeout(() => {
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    spawnBot();
  }, delay);
}
function startHourlyRestart() {
  if (hourlyTimer) clearInterval(hourlyTimer);
  hourlyTimer = setInterval(() => {
    console.log("[wrapper] hourly restart triggered — restarting child");
    try {
      if (bot) {
        bot.kill("SIGTERM");
        setTimeout(() => {
          try { if (bot && !bot.killed) bot.kill("SIGKILL"); } catch(e){}
        }, 8000);
      }
    } catch (e) {
      console.error("[wrapper] error sending hourly restart signal:", e);
    }
  }, HOURLY_RESTART_MS);
}
function forwardSignals() {
  ["SIGINT", "SIGTERM", "SIGHUP"].forEach((sig) => {
    process.on(sig, () => {
      console.log(`[wrapper] Received ${sig}, forwarding to child and exiting wrapper`);
      try {
        if (bot) bot.kill(sig);
      } catch (e) {}
      setTimeout(() => process.exit(0), 3000);
    });
  });

  process.on("uncaughtException", (err) => {
    console.error("[wrapper] uncaughtException:", err && err.stack ? err.stack : err);
    try { if (bot) bot.kill("SIGTERM"); } catch(e){}
    setTimeout(() => process.exit(1), 2000);
  });

  process.on("unhandledRejection", (rej) => {
    console.error("[wrapper] unhandledRejection:", rej);
  });
}

function start() {
  try {
    if (!fs.existsSync(path.join(CWD, APP_FILE))) {
      console.error(`[wrapper] ERROR: ${APP_FILE} not found in ${CWD}`);
      process.exit(1);
    }
  } catch (e) {
    console.error("[wrapper] fs check error:", e);
  }

  forwardSignals();
  spawnBot();
  startHourlyRestart();
}

start();