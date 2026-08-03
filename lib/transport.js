const net = require("node:net");
const { spawn } = require("node:child_process");

function port(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) throw new Error(`invalid tunnel port: ${value}`);
  return parsed;
}

function buildSshArgs(config = {}) {
  if (!config.ssh_host || !/^[A-Za-z0-9._:-]+$/.test(config.ssh_host)) throw new Error("ssh_host is required and must be a hostname or address");
  if (config.ssh_user && !/^[A-Za-z0-9._-]+$/.test(config.ssh_user)) throw new Error("invalid ssh_user");
  if (config.ssh_identity_file && /[\0\r\n]/.test(config.ssh_identity_file)) throw new Error("invalid ssh_identity_file");
  const localPort = port(config.ssh_local_port, 3000);
  const remotePort = port(config.ssh_remote_port, 3000);
  const remoteHost = config.ssh_remote_host || "127.0.0.1";
  if (/[^A-Za-z0-9._:-]/.test(remoteHost)) throw new Error("invalid ssh_remote_host");
  const sshPort = port(config.ssh_port, 22);
  const destination = config.ssh_user ? `${config.ssh_user}@${config.ssh_host}` : config.ssh_host;
  const args = [
    "-N", "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes",
    "-p", String(sshPort), "-L", `${localPort}:${remoteHost}:${remotePort}`,
  ];
  if (config.ssh_identity_file) args.push("-i", config.ssh_identity_file);
  args.push(destination);
  return { args, localPort };
}

function waitForPort(localPort, child, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      child.off("exit", onExit);
      child.off("error", onError);
      if (err) reject(err); else resolve();
    };
    const onExit = (code) => finish(new Error(`SSH tunnel exited before becoming ready (code ${code})`));
    const onError = (err) => finish(new Error(`Unable to start SSH tunnel: ${err.message}`));
    child.once("exit", onExit);
    child.once("error", onError);
    const attempt = () => {
      if (done) return;
      const socket = net.createConnection({ host: "127.0.0.1", port: localPort });
      socket.once("connect", () => { socket.destroy(); finish(); });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() - started >= timeoutMs) finish(new Error(`SSH tunnel did not become ready on localhost:${localPort}`));
        else setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function withManagedTransport(config = {}, fn, deps = {}) {
  if ((config.transport || "direct") !== "ssh") return fn();
  const { args, localPort } = buildSshArgs(config);
  const spawnFn = deps.spawn || spawn;
  const child = spawnFn("ssh", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  if (child.stderr) child.stderr.on("data", (chunk) => { stderr = (stderr + chunk.toString()).slice(-2000); });
  try {
    await (deps.waitForPort || waitForPort)(localPort, child);
    process.env.SALTCORN_PROJECT_SYNC_BASE_URL = `http://127.0.0.1:${localPort}`;
    return await fn();
  } catch (err) {
    if (stderr.trim()) throw new Error(`${err.message}: ${stderr.trim()}`);
    throw err;
  } finally {
    if (child && child.exitCode == null && typeof child.kill === "function") child.kill("SIGTERM");
  }
}

module.exports = { buildSshArgs, waitForPort, withManagedTransport };
