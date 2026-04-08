/*
  What this file does:
  Provides a curated local-only static password source pack for common and default credentials.

  Why it exists:
  SafePrompt Guard needs a small offline baseline for common/default passwords without relying on
  large breach corpora or live API calls.

  How to extend it:
  Add or remove entries in the curated arrays below, keeping the list intentionally compact and
  high-confidence to avoid false positives and extension bloat.
*/

(function attachSafePromptPasswordSources(global) {
  const source = {
    commonPasswords: [
      "123456",
      "12345678",
      "123456789",
      "1234567890",
      "111111",
      "abc123",
      "admin123",
      "admin1234",
      "changeme",
      "changeme123",
      "default",
      "letmein",
      "letmein123",
      "Passw0rd",
      "Passw0rd!",
      "Password1",
      "Password1!",
      "Password123",
      "Password123!",
      "P@ssw0rd",
      "P@ssword1",
      "Qwerty123",
      "Qwerty123!",
      "TempPass123",
      "TempPass123!",
      "Welcome1",
      "Welcome1!",
      "Welcome123",
      "Welcome123!"
    ],
    defaultPasswords: [
      "admin",
      "administrator",
      "cisco",
      "default",
      "guest",
      "manager",
      "oracle",
      "password",
      "password1",
      "public",
      "root",
      "support",
      "system",
      "toor",
      "user"
    ],
    defaultCredentialPairs: [
      { username: "admin", password: "admin" },
      { username: "admin", password: "password" },
      { username: "admin", password: "123456" },
      { username: "administrator", password: "administrator" },
      { username: "cisco", password: "cisco" },
      { username: "guest", password: "guest" },
      { username: "manager", password: "manager" },
      { username: "oracle", password: "oracle" },
      { username: "root", password: "root" },
      { username: "root", password: "toor" },
      { username: "sa", password: "sa" },
      { username: "support", password: "support" },
      { username: "user", password: "user" }
    ],
    metadata: {
      posture: "local-first-static-bundle",
      curatedFrom: [
        "SecLists Common-Credentials",
        "SecLists Default-Credentials",
        "CIRT Default Password Database"
      ],
      notes: "Curated high-confidence subset only. Full breach corpora and live APIs are intentionally excluded from v1."
    }
  };

  global.SafePromptPasswordSources = source;
})(globalThis);
