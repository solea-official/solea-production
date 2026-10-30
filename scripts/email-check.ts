import { verifyEmailTransport, safeEmailFailure } from "../src/server/email";
try {
  await verifyEmailTransport();
  console.log(
    "SMTP TLS connection and authentication succeeded. No email was sent. Sender verification and mailbox delivery still require checking in your provider and test mailboxes.",
  );
} catch (error) {
  console.error(
    JSON.stringify({
      event: "email.check-failed",
      code: safeEmailFailure(error),
    }),
  );
  process.exitCode = 1;
}
