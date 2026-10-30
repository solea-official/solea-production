import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:tls";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const exec = promisify(execFile);
test("real SMTP transport negotiates authenticated TLS, sends multipart mail and rejects an untrusted certificate (local server only)", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "solea-smtp-"));
  const cert = path.join(dir, "cert.pem"),
    key = path.join(dir, "key.pem");
  await exec("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=DNS:localhost",
  ]);
  let delivered = "",
    recipient = "",
    authenticated = false;
  const server = createServer(
    { key: await readFile(key), cert: await readFile(cert) },
    (socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost SMTP fixture\r\n");
      let buffer = "",
        data = false;
      socket.on("error", () => {});
      socket.on("data", (chunk) => {
        buffer += chunk;
        while (buffer.includes("\r\n")) {
          const i = buffer.indexOf("\r\n"),
            line = buffer.slice(0, i);
          buffer = buffer.slice(i + 2);
          if (data) {
            if (line === ".") {
              data = false;
              socket.write("250 2.0.0 accepted\r\n");
            } else delivered += line + "\r\n";
          } else if (/^EHLO /.test(line))
            socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          else if (/^AUTH PLAIN /.test(line)) {
            authenticated = true;
            socket.write("235 2.7.0 authenticated\r\n");
          } else if (/^MAIL FROM:/.test(line))
            socket.write(
              authenticated
                ? "250 sender ok\r\n"
                : "530 authentication required\r\n",
            );
          else if (/^RCPT TO:/.test(line)) {
            recipient = line;
            socket.write("250 recipient ok\r\n");
          } else if (line === "DATA") {
            data = true;
            socket.write("354 send content\r\n");
          } else if (line === "QUIT") socket.end("221 goodbye\r\n");
          else socket.write("250 ok\r\n");
        }
      });
    },
  );
  server.on("tlsClientError", () => {});
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(2465, "127.0.0.1", resolve);
  });
  try {
    const env = {
      ...process.env,
      EMAIL_PROVIDER: "smtp",
      EMAIL_DOMAIN_VERIFIED: "true",
      EMAIL_FROM: "SOLÉA Support <support@example.invalid>",
      SMTP_HOST: "localhost",
      SMTP_PORT: "2465",
      SMTP_USER: "fixture",
      SMTP_PASSWORD: randomBytes(24).toString("hex"),
    };
    const code =
      'import {smtpEmail,safeEmailFailure} from "./src/server/email.ts"; try {await smtpEmail("mailbox@example.invalid","SOLÉA SMTP test","Plain text","local-test","<p>HTML text</p>");console.log("ACCEPTED")}catch(e){console.log(safeEmailFailure(e));process.exitCode=1}';
    const result = await exec(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", code],
      { env: { ...env, NODE_EXTRA_CA_CERTS: cert } },
    );
    assert.equal(result.stdout.trim(), "ACCEPTED");
    assert.ok(authenticated);
    assert.equal(recipient, "RCPT TO:<mailbox@example.invalid>");
    assert.match(delivered, /multipart\/alternative/);
    assert.match(delivered, /Resend-Idempotency-Key: local-test/);
    assert.match(delivered, /text\/plain/);
    assert.match(delivered, /text\/html/);
    await assert.rejects(
      () =>
        exec(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", code],
          { env: { ...env, NODE_EXTRA_CA_CERTS: "" } },
        ),
      (e) => (e as { stdout?: string }).stdout?.trim() === "ESOCKET",
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
