/*
  What this file does:
  Detects secrets, risky internal references, and provides deterministic masking and replacement suggestions.

  Why it exists:
  The POC needs one local detection engine that stays readable, low-noise, and easy to extend without a backend.

  How to extend it:
  Add patterns, tune thresholds, update replacement templates below, or expand org_rules.json with local names and phrases.
*/

(function attachSafePromptDetector(global) {
  const HIGH = "HIGH";
  const MEDIUM = "MEDIUM";
  const LOW = "LOW";
  const NONE = "NONE";
  const ENTROPY_THRESHOLD = 3.5;
  const MIN_ENTROPY_LENGTH = 21;
  const CONTEXT_RADIUS = 48;
  const SECRET_RADIUS = 80;
  const VALID_LEARNED_TYPES = Object.freeze(["password", "token", "api_key", "secret", "internal_reference"]);
  const STATIC_PASSWORD_SOURCE = normalizeStaticPasswordSource(global.SafePromptPasswordSources || {});
  const DEFAULT_RULES = {
    customerNames: ["Alpha", "Beta", "Gamma"],
    projectNames: ["ProjectRed", "Orion", "Falcon"],
    internalCodeNames: ["DeltaOps"],
    productNames: ["ProductThree", "Attivio", "ProductOne"],
    internalOnlyPhrases: ["internal migration manual", "customer files", "private environment"],
    allowlistedTerms: ["port", "sql", "docker", "server", "vm", "cluster", "coll-dock", "environment", "database"],
    riskyContextWords: ["password", "token", "secret", "key", "credential", "internal", "confidential", "customer", "prod", "tenant", "migration", "attachment", "document"]
  };
  const BASE_ALLOWLIST = ["backup", "cluster", "coll-dock", "database", "docker", "environment", "host", "machine", "migration", "nuxeo", "port", "resource group", "server", "service", "sql", "tenant", "vm"];
  const REPLACEMENT_TEMPLATES = Object.freeze({
    password: "[PASSWORD_REDACTED]",
    token: "[TOKEN_REDACTED]",
    api_key: "[API_KEY_REDACTED]",
    secret: "[SECRET_REDACTED]",
    internal_ip: "[INTERNAL_IP_REDACTED]",
    internal_url: "[INTERNAL_URL]",
    internal_host: "[INTERNAL_HOST]",
    account_name: "[ACCOUNT_NAME]",
    environment_name: "[ENVIRONMENT_NAME]",
    resource_identifier: "[RESOURCE_ID]",
    access_target: "[ACCESS_TARGET]",
    customer_name: "[CUSTOMER_NAME]",
    project_name: "[PROJECT_NAME]",
    internal_codename: "[INTERNAL_NAME]",
    product_name: "[PRODUCT_NAME]",
    internal_reference: "[INTERNAL_REFERENCE]",
    private_key: "[PRIVATE_KEY_REDACTED]",
    connection_string: "[CONNECTION_STRING_REDACTED]",
    email: "[EMAIL_REDACTED]"
  });
  const MASK_TEMPLATES = Object.freeze({
    password: "********",
    token: "[MASKED]",
    api_key: "[MASKED]",
    secret: "[MASKED]",
    internal_ip: "[MASKED_IP]",
    internal_url: "[MASKED_URL]",
    internal_host: "[MASKED_HOST]",
    account_name: "[MASKED_ACCOUNT]",
    environment_name: "[MASKED_ENV]",
    resource_identifier: "[MASKED_ID]",
    access_target: "[MASKED_TARGET]",
    customer_name: "[MASKED]",
    project_name: "[MASKED]",
    internal_codename: "[MASKED]",
    product_name: "[MASKED]",
    internal_reference: "[MASKED]",
    private_key: "[MASKED]",
    connection_string: "[MASKED]",
    email: "[MASKED]"
  });
  const SECRET_TYPES = new Set(["Password", "Token", "API key", "Secret", "Connection string", "JWT", "OpenAI key", "GitHub token", "AWS key", "Private key", "High entropy token or API key", "Email address"]);
  const TEST_CASES = [
    { name: "password", input: "ExamplePass!2026", expectedSeverities: [HIGH], expectedTypes: ["Password"] },
    {
      name: "common-password-static-pack",
      input: "Please rotate Password123 after cutover.",
      expectedSeverities: [HIGH],
      expectedTypes: ["Password"],
      expectedReasons: ["Known common password"],
      replaceExpected: "Please rotate [PASSWORD_REDACTED] after cutover."
    },
    {
      name: "default-password-pair-static-pack",
      input: "Username: admin\nPassword: admin",
      expectedSeverities: [HIGH],
      expectedTypes: ["Account name", "Password"],
      expectedReasons: ["Known default username/password pair"]
    },
    { name: "entropy-token", input: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", expectedSeverities: [HIGH], expectedTypes: ["High entropy token or API key"] },
    { name: "port", input: "Port 1433", expectedSeverities: [NONE] },
    { name: "project-alone", input: "project ProjectRed", expectedSeverities: [LOW, NONE] },
    { name: "project-context", input: "ProjectRed internal migration document", expectedSeverities: [MEDIUM], expectedTypes: ["Project name"] },
    { name: "project-plus-password", input: "ProjectRed password: ExamplePass!2026", expectedSeverities: [HIGH], expectedTypes: ["Password", "Project name"], replaceExpected: "[PROJECT_NAME] password: [PASSWORD_REDACTED]" },
    { name: "ipv4", input: "192.168.1.10", expectedSeverities: [MEDIUM], expectedTypes: ["Internal IP address"], replaceExpected: "[INTERNAL_IP_REDACTED]" },
    { name: "customer-plus-token", input: "Customer Alpha token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef", expectedSeverities: [HIGH], expectedTypes: ["Customer name", "High entropy token or API key"], replaceExpected: "Customer [CUSTOMER_NAME] token [TOKEN_REDACTED]" },
    { name: "email", input: "Please contact john.doe@example.com", expectedSeverities: [MEDIUM], expectedTypes: ["Email address"], replaceExpected: "Please contact [EMAIL_REDACTED]" },
    {
      name: "long-technical-email",
      input:
        "Hello team, Port 1433 is required for migration. Server coll-dock is up. The ProductOne 4 environment is paused. Please use token 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef for emergency recovery.",
      expectedSeverities: [HIGH],
      expectedTypes: ["High entropy token or API key"]
    },
    {
      name: "phoenix-credential-email",
      input:
        "Subject: Phoenix Platform Deployment Details\n\nService Account Token:\n\nk8s_token: k8s-demo-token-000111222333\n\nDocker Registry:\npassword: DemoRegistryPass!2026\n\nRedis Cache:\nREDIS_PASSWORD=DemoCachePass!2026",
      expectedSeverities: [HIGH],
      expectedTypes: ["Token", "Password"]
    },
    {
      name: "private-ip",
      input: "REDIS_HOST=10.99.12.45",
      expectedSeverities: [MEDIUM],
      expectedTypes: ["Internal IP address"],
      replaceExpected: "REDIS_HOST=[INTERNAL_IP_REDACTED]"
    },
    {
      name: "email-suite-orion",
      input:
        "Subject: Orion Migration Readiness\nProject Name: Orion\nCustomer Name: Northwind Analytics\nEnvironment: orion-prod\nInternal URL: https://orion-prod.internal.local\nServer IP: 172.20.4.17\nUsername: orion_admin\nPassword: DemoTempPass!2026\nDB_HOST=172.20.4.21\nDB_NAME=oriondb\nDB_USER=dbadmin\nDB_PASSWORD=DemoDbPass!2026",
      expectedSeverities: [HIGH],
      expectedTypes: ["Project name", "Customer name", "Environment name", "Internal URL", "Internal IP address", "Account name", "Password"],
      expectedMinActionable: 9
    },
    {
      name: "email-suite-phoenix-api",
      input:
        "Customer: Contoso Logistics\nBelow are the integration credentials for Phoenix Platform.\nAPI Endpoint:\nhttps://api.phoenix.internal/v1\nclient_id=phoenix-client-001\nclient_secret=DemoClientSecret!2026\nwebhook_token=wh_demo_1234567890abcd\nAuthorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.EXAMPLEPAYLOAD.EXAMPLESIGNATURE",
      expectedSeverities: [HIGH],
      expectedTypes: ["Customer name", "Product name", "Internal URL", "Resource identifier", "Secret", "Token"],
      expectedMinActionable: 6
    },
    {
      name: "email-suite-atlas-infra",
      input:
        "The infrastructure for Project Atlas has been provisioned.\nCustomer: Fabrikam Industries\nPrimary Host: atlas-app01.internal.local\nBackup Host: atlas-db01.internal.local\n10.88.21.17\n10.88.21.18\nssh deploy@10.88.21.17\nPassword: DemoDeployPass!2026\nregistry.internal.local:5000\nUsername: docker_admin\nPassword: DemoRegistryPass!2026",
      expectedSeverities: [HIGH],
      expectedTypes: ["Project name", "Customer name", "Internal host", "Internal IP address", "Access target", "Password", "Account name"],
      expectedMinActionable: 9
    },
    {
      name: "email-suite-nova-db",
      input:
        "We will perform maintenance for Project Nova tonight.\nCustomer: Global Retail Systems\nServer: db-nova.internal\nPort: 1433\nUsername: sa\nPassword: DemoSqlPass!2026\nServer=172.20.6.45;Database=nova;User Id=admin;Password=DemoServerPass!2026;\nStorage Account: novabackups\nAccess Key: DemoBackupKey123456",
      expectedSeverities: [HIGH],
      expectedTypes: ["Project name", "Customer name", "Internal host", "Resource identifier", "Account name", "Password", "Internal IP address", "API key"],
      expectedMinActionable: 9
    },
    {
      name: "email-suite-helios-cloud",
      input:
        "The cloud environment for Helios is ready.\nCustomer: BlueWave Energy\nTenant ID: 784392048392\nSubscription ID: 239847239847\nAWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nAWS_SECRET_ACCESS_KEY=DemoSecretKey123456\nVPN_USER=vpn_admin\nVPN_PASSWORD=DemoVpnPass!2026\nhttps://helios-cloud.internal.local",
      expectedSeverities: [HIGH],
      expectedTypes: ["Project name", "Customer name", "Resource identifier", "AWS key", "Secret", "Account name", "Password", "Internal URL"],
      expectedMinActionable: 8
    },
    {
      name: "email-suite-vega-support",
      input:
        "We are handing over the Vega environment to the support team.\nCustomer: Silverline Telecom\nhttps://vega.internal.local\nhttps://vega-admin.internal.local\nREDIS_HOST=172.20.7.10\nREDIS_PASSWORD=DemoCachePass!2026\nsession_secret=DemoSessionSecret!2026\nmongodb://admin:DemoMongoPass!2026@172.20.7.12:27017",
      expectedSeverities: [HIGH],
      expectedTypes: ["Project name", "Customer name", "Internal URL", "Internal IP address", "Password", "Secret", "Connection string"],
      expectedMinActionable: 7
    },
    {
      name: "email-suite-demo-access",
      input:
        "Subject: Demo Environment Access Details\nCustomer: Demo Corporation\nProject: DemoSales\nEnvironment: demo-sales-prod\nUsername: demo_admin\nPassword: ExampleAccess2026\nhttps://demo-sales.company-demo.local\nPrimary Host: demo-app01.company-demo.local\nDatabase Host: demo-db01.company-demo.local\n10.10.10.11\n10.10.10.12",
      expectedSeverities: [HIGH],
      expectedTypes: ["Customer name", "Project name", "Environment name", "Account name", "Password", "Internal URL", "Internal host", "Internal IP address"],
      expectedMinActionable: 10
    },
    {
      name: "learned-password-exact-match",
      setupLearnedSecrets: [{ id: "lp1", value: "ManualPass2026", type: "password" }],
      input: "Use ManualPass2026 for the next login.",
      expectedSeverities: [HIGH],
      expectedTypes: ["Password"]
    },
    {
      name: "learned-token-exact-match",
      setupLearnedSecrets: [{ id: "lt1", value: "tok_ABC123XYZ", type: "token" }],
      input: "temporary token tok_ABC123XYZ",
      expectedSeverities: [HIGH],
      expectedTypes: ["Token"]
    },
    {
      name: "learned-internal-reference-exact-match",
      setupLearnedSecrets: [{ id: "li1", value: "Phoenix Playbook", type: "internal_reference" }],
      input: "Open the Phoenix Playbook before cutover.",
      expectedSeverities: [MEDIUM],
      expectedTypes: ["Internal reference"]
    },
    {
      name: "learned-exact-case-sensitive-no-match",
      setupLearnedSecrets: [{ id: "lc1", value: "ManualPass2026", type: "password" }],
      input: "Use manualpass2026 for the next login.",
      expectedSeverities: [NONE]
    }
  ];

  let rules = normalizeRules(DEFAULT_RULES);
  let learnedSecrets = [];
  let initPromise = null;
  let lastLoadError = null;
  let lastRulesSource = "default";
  let lastLearnedLoadError = null;
  let lastLearnedSource = "default";

  function initialize() {
    if (initPromise) {
      return initPromise;
    }

    initPromise = Promise.all([loadRules(), loadLearnedSecrets()]).then(() => rules);
    return initPromise;
  }

  async function loadRules() {
    lastLoadError = null;
    lastRulesSource = "default";
    try {
      const response = await fetch(global.chrome.runtime.getURL("org_rules.json"));
      if (response.ok) {
        const payload = await response.json();
        rules = normalizeRules(mergeRules(DEFAULT_RULES, validateRulesObject(payload)));
        lastRulesSource = "org_rules.json";
      }
    } catch (error) {
      lastLoadError = error instanceof Error ? error.message : String(error);
    }

    return rules;
  }

  async function loadLearnedSecrets() {
    lastLearnedLoadError = null;
    lastLearnedSource = "default";
    try {
      if (!global.chrome?.storage?.local?.get) {
        learnedSecrets = [];
        return learnedSecrets;
      }
      const state = await global.chrome.storage.local.get({ learnedSecrets: [] });
      learnedSecrets = normalizeLearnedSecrets(state.learnedSecrets);
      lastLearnedSource = "chrome.storage.local";
    } catch (error) {
      lastLearnedLoadError = error instanceof Error ? error.message : String(error);
      learnedSecrets = [];
    }

    return learnedSecrets;
  }

  function setLearnedSecrets(entries) {
    learnedSecrets = normalizeLearnedSecrets(entries);
    lastLearnedSource = "runtime";
    lastLearnedLoadError = null;
    return learnedSecrets;
  }

  function detectSensitiveData(text) {
    if (typeof text !== "string" || !text.trim()) {
      return [];
    }

    const findings = [];
    addAssignments(findings, text);
    addLearnedSecretCandidates(findings, text);
    addLabeledCredentialCandidates(findings, text);
    addStaticPasswordPackCandidates(findings, text);
    addStructuredFieldCandidates(findings, text);
    addContextualNameCandidates(findings, text);
    addPattern(findings, text, /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, { type: "JWT", reason: "JWT format", replacementKey: "token" });
    addPattern(findings, text, /\b[a-f0-9]{64}\b/gi, { type: "High entropy token or API key", reason: "64-character hex secret", replacementKey: "token" });
    addPattern(findings, text, /\bAKIA[0-9A-Z]{16}\b/g, { type: "AWS key", reason: "AWS access key format", replacementKey: "api_key" });
    addPattern(findings, text, /\bgh[pousr]_[A-Za-z0-9]{20,255}\b/g, { type: "GitHub token", reason: "GitHub token format", replacementKey: "token" });
    addPattern(findings, text, /\bsk-(?:proj-)?[A-Za-z0-9-]{20,}\b/g, { type: "OpenAI key", reason: "OpenAI key format", replacementKey: "api_key" });
    addPattern(findings, text, /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, { type: "Private key", reason: "Private key block", replacementKey: "private_key" });
    addConnectionUriCandidates(findings, text);
    addPrivateIpCandidates(findings, text);
    addInternalUrlCandidates(findings, text);
    addInternalHostCandidates(findings, text);
    addAccessTargetCandidates(findings, text);
    addEmailCandidates(findings, text);
    addPasswordCandidates(findings, text);
    addEntropyCandidates(findings, text);
    addInternalPhrases(findings, text);
    addOrgTerms(findings, text);
    escalateOrgFindings(findings);
    return dedupe(findings).map(enrich);
  }

  function addAssignments(findings, text) {
    const pattern = /\b([A-Za-z][A-Za-z0-9._-]{0,63}(?:password|passwd|pwd|token|apikey|api[_ -]?key|secret)[A-Za-z0-9._-]{0,63})\b\s*(?::|=)\s*([^\s"'`,;]{4,})/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[2];
      const start = match.index + match[0].lastIndexOf(value);
      const info = keywordInfo(match[1]);
      addSecret(findings, {
        start,
        end: start + value.length,
        match: value,
        type: info.type,
        reason: info.type === "Password" ? "Possible password" : "Secret keyword matched",
        severity: HIGH,
        layer: "pattern",
        replacementKey: info.replacementKey,
        trustedContext: true
      });
    }

    const bearer = /\bbearer(?:\s+token)?\s+([A-Za-z0-9._\-+/=]{12,})/gi;
    while ((match = bearer.exec(text)) !== null) {
      const value = match[1];
      const start = match.index + match[0].lastIndexOf(value);
      addSecret(findings, { start, end: start + value.length, match: value, type: "Token", reason: "Bearer token pattern", severity: HIGH, layer: "pattern", replacementKey: "token", trustedContext: true });
    }

    const connection = /\bconnection string\b\s*(?::|=)\s*([^\n\r]{12,})/gi;
    while ((match = connection.exec(text)) !== null) {
      const value = match[1].trim();
      const start = match.index + match[0].lastIndexOf(value);
      addSecret(findings, { start, end: start + value.length, match: value, type: "Connection string", reason: "Connection string keyword", severity: HIGH, layer: "pattern", replacementKey: "connection_string", trustedContext: true });
    }
  }

  function addLabeledCredentialCandidates(findings, text) {
    const pattern = /(^|[\n\r;])\s*((?:user(?:name)?|login(?: name)?|account(?: name)?|db user|db username|user id|vpn user)|(?:password|passwd|pwd))\s*[:=]\s*([^;\n\r]{1,200})/gim;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rawValue = trimStructuredValue(match[3]);
      if (!rawValue) {
        continue;
      }

      const start = match.index + match[0].lastIndexOf(rawValue);
      const end = start + rawValue.length;
      const labelNorm = normalizeLabel(match[2]);
      const isPasswordField = /\b(password|passwd|pwd)\b/.test(labelNorm);

      addSecret(findings, {
        start,
        end,
        match: rawValue,
        type: isPasswordField ? "Password" : "Account name",
        reason: isPasswordField ? "Possible password" : "Account identifier",
        severity: isPasswordField ? HIGH : MEDIUM,
        category: isPasswordField ? "secret" : "internal",
        layer: "pattern",
        replacementKey: isPasswordField ? "password" : "account_name",
        trustedContext: true
      });
    }
  }

  function addLearnedSecretCandidates(findings, text) {
    normalizeLearnedSecrets(learnedSecrets).forEach((entry) => {
      const config = learnedConfig(entry.type);
      if (!config || !entry.value) {
        return;
      }

      for (const start of findExactMatchStarts(text, entry.value)) {
        addSecret(findings, {
          start,
          end: start + entry.value.length,
          match: entry.value,
          type: config.type,
          reason: config.reason,
          severity: config.severity,
          category: config.category,
          layer: "learned",
          replacementKey: config.replacementKey,
          trustedContext: true,
          learnedId: entry.id,
          learnedType: entry.type
        });
      }
    });
  }

  function addStaticPasswordPackCandidates(findings, text) {
    if (
      !STATIC_PASSWORD_SOURCE.commonPasswords.size &&
      !STATIC_PASSWORD_SOURCE.defaultPasswords.size &&
      !STATIC_PASSWORD_SOURCE.defaultCredentialPairs.length
    ) {
      return;
    }

    const credentialRows = collectStructuredCredentialRows(text);
    const candidates = collectStaticPasswordCandidates(text);

    candidates.forEach((candidate) => {
      const classification = classifyStaticPasswordCandidate(candidate, credentialRows);
      if (!classification) {
        return;
      }

      addSecret(findings, {
        start: candidate.start,
        end: candidate.end,
        match: candidate.value,
        type: "Password",
        reason: classification.reason,
        severity: HIGH,
        layer: "static",
        replacementKey: "password",
        trustedContext: candidate.trustedContext
      });
    });
  }

  function collectStaticPasswordCandidates(text) {
    const candidates = [];
    const seen = new Set();
    const addCandidate = (start, value, trustedContext) => {
      const cleanValue = trimStructuredValue(value);
      if (!cleanValue) {
        return;
      }
      const key = `${start}|${cleanValue}|${trustedContext ? 1 : 0}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      candidates.push({
        start,
        end: start + cleanValue.length,
        value: cleanValue,
        trustedContext: Boolean(trustedContext),
        line: getLineNumberAt(text, start)
      });
    };

    const assignmentPattern = /\b([A-Za-z][A-Za-z0-9._-]{0,63}(?:password|passwd|pwd)[A-Za-z0-9._-]{0,63})\b\s*(?::|=)\s*([^\s"'`,;]{1,128})/gi;
    let match;
    while ((match = assignmentPattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[2]);
      const start = match.index + match[0].lastIndexOf(value);
      addCandidate(start, value, true);
    }

    const labeledPattern = /(^|[\n\r;])\s*((?:password|passwd|pwd))\s*[:=]\s*([^;\n\r]{1,200})/gim;
    while ((match = labeledPattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[3]);
      const start = match.index + match[0].lastIndexOf(value);
      addCandidate(start, value, true);
    }

    const structuredPattern = /(^|[\n\r;])\s*([A-Za-z][A-Za-z0-9 _.-]{1,40})\s*[:=]\s*([^;\n\r]{1,200})/gm;
    while ((match = structuredPattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[3]);
      if (!value) {
        continue;
      }
      const start = match.index + match[0].lastIndexOf(value);
      const end = start + value.length;
      const classification = classifyStructuredField(match[2], value, buildContextSegment(text, start, end));
      if (classification?.type === "Password") {
        addCandidate(start, value, true);
      }
    }

    const genericPattern = /(^|[\s"'`([{])([^\s"'`)\]}]{8,64})(?=$|[\s"'`)\]}])/gm;
    while ((match = genericPattern.exec(text)) !== null) {
      const value = match[2];
      if (
        looksLikeAssignmentFragment(value) ||
        looksLikeCredentialedUri(value) ||
        value.includes("://") ||
        isIpv4(value) ||
        isUrl(value) ||
        isFilePath(value) ||
        isVersion(value) ||
        isHostname(value)
      ) {
        continue;
      }
      addCandidate(match.index + match[1].length, value, false);
    }

    return candidates;
  }

  function classifyStaticPasswordCandidate(candidate, credentialRows) {
    if (!candidate?.value) {
      return null;
    }

    if (STATIC_PASSWORD_SOURCE.commonPasswords.has(candidate.value)) {
      return { reason: "Known common password" };
    }

    if (!candidate.trustedContext) {
      return null;
    }

    const matchedRow = findNearestCredentialRow(candidate.start, credentialRows, "password", candidate.line);
    const pairedAccount = matchedRow ? findNearestCredentialRow(matchedRow.start, credentialRows, "account", matchedRow.line) : null;
    if (
      pairedAccount &&
      STATIC_PASSWORD_SOURCE.defaultCredentialPairIndex.has(
        `${pairedAccount.value}\u0000${candidate.value}`
      )
    ) {
      return { reason: "Known default username/password pair" };
    }

    if (STATIC_PASSWORD_SOURCE.defaultPasswords.has(candidate.value)) {
      return { reason: "Known default credential password" };
    }

    return null;
  }

  function collectStructuredCredentialRows(text) {
    const rows = [];
    const pattern = /(^|[\n\r;])\s*([A-Za-z][A-Za-z0-9 _.-]{1,40})\s*[:=]\s*([^;\n\r]{1,200})/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[3]);
      if (!value) {
        continue;
      }
      const labelNorm = normalizeLabel(match[2]);
      let role = null;
      if (/\b(password|passwd|pwd)\b/.test(labelNorm)) {
        role = "password";
      } else if (/\b(username|user name|db user|user id|vpn user|login|account(?: name)?)\b/.test(labelNorm)) {
        role = "account";
      }
      if (!role) {
        continue;
      }
      const start = match.index + match[0].lastIndexOf(value);
      rows.push({
        role,
        label: match[2],
        value,
        start,
        end: start + value.length,
        line: getLineNumberAt(text, start)
      });
    }
    return rows;
  }

  function findNearestCredentialRow(start, rows, role, lineHint = null) {
    const matching = rows.filter((row) => row.role === role && Math.abs(row.start - start) <= 200);
    if (!matching.length) {
      return null;
    }
    return matching.sort((left, right) => {
      const lineDistanceLeft = lineHint === null ? 0 : Math.abs(left.line - lineHint);
      const lineDistanceRight = lineHint === null ? 0 : Math.abs(right.line - lineHint);
      if (lineDistanceLeft !== lineDistanceRight) {
        return lineDistanceLeft - lineDistanceRight;
      }
      return Math.abs(left.start - start) - Math.abs(right.start - start);
    })[0];
  }

  function addEmailCandidates(findings, text) {
    const pattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addSecret(findings, {
        start: match.index,
        end: match.index + match[0].length,
        match: match[0],
        type: "Email address",
        reason: "Email address detected",
        severity: MEDIUM,
        layer: "pattern",
        replacementKey: "email"
      });
    }
  }

  function addPrivateIpCandidates(findings, text) {
    const pattern = /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!isIpv4(match[0])) {
        continue;
      }
      addSecret(findings, {
        start: match.index,
        end: match.index + match[0].length,
        match: match[0],
        type: "Internal IP address",
        reason: "Private/internal IP address detected",
        severity: MEDIUM,
        layer: "pattern",
        replacementKey: "internal_ip"
      });
    }
  }

  function addStructuredFieldCandidates(findings, text) {
    const pattern = /(^|[\n\r;])\s*([A-Za-z][A-Za-z0-9 _.-]{1,40})\s*[:=]\s*([^;\n\r]{1,200})/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const rawValue = trimStructuredValue(match[3]);
      if (!rawValue) {
        continue;
      }
      const start = match.index + match[0].lastIndexOf(rawValue);
      const end = start + rawValue.length;
      const classification = classifyStructuredField(match[2], rawValue, buildContextSegment(text, start, end));
      if (!classification) {
        continue;
      }
      addSecret(findings, {
        start,
        end,
        match: rawValue,
        ...classification
      });
    }
  }

  function addContextualNameCandidates(findings, text) {
    addNamedPattern(findings, text, /\bProject\s+(?!Name\b)([A-Z][A-Za-z0-9-]+(?:\s+[A-Z][A-Za-z0-9-]+){0,2})\b/g, {
      type: "Project name",
      reason: "Project referenced",
      replacementKey: "project_name"
    });
    addNamedPattern(findings, text, /\b([A-Z][A-Za-z0-9-]+(?:\s+[A-Z][A-Za-z0-9-]+)?)\s+Platform\b/g, {
      type: "Product name",
      reason: "Platform referenced",
      replacementKey: "product_name",
      useFullMatch: true
    });
    addNamedPattern(findings, text, /\b([A-Z][A-Za-z0-9-]+)\s+environment\b/g, {
      type: "Project name",
      reason: "Environment referenced",
      replacementKey: "project_name"
    });
    addNamedPattern(findings, text, /\bfor\s+([A-Z][A-Za-z0-9-]+(?:\s+[A-Z][A-Za-z0-9-]+)?)\s+is ready\b/g, {
      type: "Project name",
      reason: "Project referenced",
      replacementKey: "project_name"
    });
  }

  function addInternalUrlCandidates(findings, text) {
    const pattern = /\bhttps?:\/\/[^\s"'<>]+/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[0]);
      if (!isInternalUrl(value)) {
        continue;
      }
      addSecret(findings, {
        start: match.index,
        end: match.index + value.length,
        match: value,
        type: "Internal URL",
        reason: "Internal URL detected",
        severity: MEDIUM,
        category: "internal",
        layer: "pattern",
        replacementKey: "internal_url"
      });
    }
  }

  function addInternalHostCandidates(findings, text) {
    const pattern = /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::\d{2,5})?\b/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[0]);
      if (isPrivateIpv4(stripPort(value)) || !isInternalHost(value) || isEmbeddedInUrl(text, match.index) || isEmbeddedInEmail(text, match.index)) {
        continue;
      }
      addSecret(findings, {
        start: match.index,
        end: match.index + value.length,
        match: value,
        type: "Internal host",
        reason: "Internal host detected",
        severity: MEDIUM,
        category: "internal",
        layer: "pattern",
        replacementKey: "internal_host"
      });
    }
  }

  function addAccessTargetCandidates(findings, text) {
    const pattern = /\b([A-Za-z_][A-Za-z0-9._-]{0,63})@((?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::\d{2,5})?))\b/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const target = stripPort(match[2]);
      if (!isPrivateIpv4(target) && !isInternalHost(match[2])) {
        continue;
      }
      const value = trimStructuredValue(match[0]);
      addSecret(findings, {
        start: match.index,
        end: match.index + value.length,
        match: value,
        type: "Access target",
        reason: "Internal access target detected",
        severity: MEDIUM,
        category: "internal",
        layer: "pattern",
        replacementKey: "access_target"
      });
    }
  }

  function addConnectionUriCandidates(findings, text) {
    const pattern = /\b(?:mongodb|postgres(?:ql)?|mysql|redis|amqp):\/\/[^\s"'<>]+/gi;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = trimStructuredValue(match[0]);
      if (!looksLikeCredentialedUri(value) && !containsInternalAddress(value)) {
        continue;
      }
      addSecret(findings, {
        start: match.index,
        end: match.index + value.length,
        match: value,
        type: "Connection string",
        reason: "Connection URI detected",
        severity: HIGH,
        layer: "pattern",
        replacementKey: "connection_string"
      });
    }
  }

  function classifyStructuredField(label, value, contextText) {
    const labelNorm = normalizeLabel(label);
    const contextNorm = normalize(contextText);

    if (!value) {
      return null;
    }

    if (/secret access key/.test(labelNorm)) {
      return { type: "Secret", reason: "Secret field", severity: HIGH, layer: "pattern", replacementKey: "secret", trustedContext: true };
    }
    if (/access key|api key|key id/.test(labelNorm)) {
      return { type: "API key", reason: "Access key field", severity: HIGH, layer: "pattern", replacementKey: "api_key", trustedContext: true };
    }
    if (/\b(password|passwd|pwd)\b/.test(labelNorm)) {
      return { type: "Password", reason: "Possible password", severity: HIGH, layer: "pattern", replacementKey: "password", trustedContext: true };
    }
    if (/\btoken\b/.test(labelNorm)) {
      return { type: "Token", reason: "Token field", severity: HIGH, layer: "pattern", replacementKey: "token", trustedContext: true };
    }
    if (/\bsecret\b/.test(labelNorm)) {
      return { type: "Secret", reason: "Secret field", severity: HIGH, layer: "pattern", replacementKey: "secret", trustedContext: true };
    }
    if (/\b(customer|customer name)\b/.test(labelNorm)) {
      return { type: "Customer name", reason: "Customer-specific reference", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "customer_name" };
    }
    if (/\b(project|project name)\b/.test(labelNorm)) {
      return { type: "Project name", reason: "Project-specific reference", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "project_name" };
    }
    if (/\benvironment\b/.test(labelNorm)) {
      return { type: "Environment name", reason: "Environment reference", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "environment_name" };
    }
    if (/\b(url|endpoint|uri)\b/.test(labelNorm) && isInternalUrl(value)) {
      return { type: "Internal URL", reason: "Internal URL field", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "internal_url" };
    }
    if ((/\b(host|server|registry)\b/.test(labelNorm) || labelNorm.startsWith("db host") || labelNorm.startsWith("redis host")) && isInternalHost(value)) {
      const type = isPrivateIpv4(stripPort(value)) ? "Internal IP address" : "Internal host";
      const replacementKey = type === "Internal IP address" ? "internal_ip" : "internal_host";
      return { type, reason: `${type} field`, severity: MEDIUM, category: "internal", layer: "context", replacementKey };
    }
    if (/\b(port)\b/.test(labelNorm) && isPort(value) && /\b(database|db|server|connection|endpoint|redis|mongo|vpn)\b/.test(contextNorm)) {
      return { type: "Resource identifier", reason: "Service port reference", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "resource_identifier" };
    }
    if (/\b(username|user name|db user|user id|vpn user|user)\b/.test(labelNorm)) {
      return { type: "Account name", reason: "Account identifier", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "account_name", trustedContext: true };
    }
    if (/ssh access/.test(labelNorm) && /^[A-Za-z0-9._-]+@/.test(value)) {
      return { type: "Access target", reason: "Access target reference", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "access_target" };
    }
    if (/\b(client id|tenant id|subscription id|db name|database|storage account|cluster name|namespace|account id|account)\b/.test(labelNorm)) {
      return { type: "Resource identifier", reason: "Internal resource identifier", severity: MEDIUM, category: "internal", layer: "context", replacementKey: "resource_identifier" };
    }
    return null;
  }

  function addNamedPattern(findings, text, pattern, options) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const capturedValue = options.useFullMatch ? match[0] : match[1];
      const offset = options.useFullMatch ? 0 : match[0].lastIndexOf(capturedValue);
      const start = match.index + offset;
      addSecret(findings, {
        start,
        end: start + capturedValue.length,
        match: capturedValue,
        type: options.type,
        reason: options.reason,
        severity: MEDIUM,
        category: "internal",
        layer: "context",
        replacementKey: options.replacementKey
      });
    }
  }

  function buildContextSegment(text, start, end) {
    return text.slice(Math.max(0, start - 96), Math.min(text.length, end + 96));
  }

  function normalizeLabel(value) {
    return normalize(String(value || "").replace(/[_-]+/g, " "));
  }

  function trimStructuredValue(value) {
    return String(value || "").trim().replace(/[;,.)]+$/, "");
  }

  function addPasswordCandidates(findings, text) {
    const pattern = /(^|[\s"'`([{])([^\s"'`)\]}]{8,64})(?=$|[\s"'`)\]}])/gm;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[2];
      if (looksLikeAssignmentFragment(value) || looksLikeCredentialedUri(value) || value.includes("://")) {
        continue;
      }
      if (!looksLikePassword(value)) {
        continue;
      }
      const start = match.index + match[1].length;
      addSecret(findings, { start, end: start + value.length, match: value, type: "Password", reason: "Possible password", severity: HIGH, layer: "pattern", replacementKey: "password" });
    }
  }

  function addEntropyCandidates(findings, text) {
    const pattern = /[A-Za-z0-9+/_=.-]{21,}/g;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const value = match[0];
      if (looksLikeAssignmentFragment(value)) {
        continue;
      }
      if (value.length < MIN_ENTROPY_LENGTH || calculateShannonEntropy(value) <= ENTROPY_THRESHOLD) {
        continue;
      }
      addSecret(findings, { start: match.index, end: match.index + value.length, match: value, type: "High entropy token or API key", reason: "Possible token / high-entropy secret", severity: HIGH, layer: "entropy", replacementKey: "token" });
    }
  }

  function addInternalPhrases(findings, text) {
    rules.internalOnlyPhrases.forEach((phrase) => {
      findMatches(text, phrase).forEach((match) => {
        findings.push({ start: match.start, end: match.end, match: match.match, type: "Internal reference", reason: "Internal-only phrase", severity: MEDIUM, category: "internal", replacementKey: "internal_reference", riskyWords: riskyWordsNear(text, match.start, match.end) });
      });
    });
  }

  function addOrgTerms(findings, text) {
    buildOrgEntries().forEach((entry) => {
      findMatches(text, entry.term).forEach((match) => {
        const riskyWords = riskyWordsNear(text, match.start, match.end);
        findings.push({ start: match.start, end: match.end, match: match.match, type: entry.type, reason: riskyWords.length ? `${entry.type} used in risky context` : `${entry.type} referenced`, severity: riskyWords.length ? MEDIUM : LOW, category: "internal", replacementKey: entry.replacementKey, riskyWords });
      });
    });
  }

  function escalateOrgFindings(findings) {
    const secrets = findings.filter(isSecret);
    findings.forEach((finding) => {
      if (finding.category !== "internal") {
        return;
      }
      if (secrets.some((secret) => nearby(finding, secret, SECRET_RADIUS))) {
        finding.severity = HIGH;
        finding.reason = "Internal term + secret detected";
      }
    });
  }

  function addPattern(findings, text, pattern, options) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      addSecret(findings, { start: match.index, end: match.index + match[0].length, match: match[0], type: options.type, reason: options.reason, severity: options.severity || HIGH, layer: options.layer || "pattern", replacementKey: options.replacementKey });
    }
  }

  function addSecret(findings, finding) {
    if (!finding.match || ignoreFinding(finding.match, finding)) {
      return;
    }
    findings.push({ category: finding.category || "secret", ...finding });
  }

  function ignoreFinding(value, finding) {
    const normalized = normalize(value);
    if (!normalized) {
      return true;
    }
    if (rules.allowlistedTerms.includes(normalized) || BASE_ALLOWLIST.includes(normalized)) {
      return true;
    }
    if (finding.category === "internal") {
      return false;
    }
    if (finding.type !== "Email address" && finding.type !== "Internal IP address" && (isIpv4(value) || isUrl(value) || isFilePath(value) || isVersion(value) || isHostname(value))) {
      return true;
    }
    if (isPort(value) && finding.type !== "Password") {
      return true;
    }
    if (isMachine(value) && !finding.trustedContext) {
      return true;
    }
    if (finding.type === "Password" && finding.layer !== "static" && !finding.trustedContext && !looksLikePassword(value)) {
      return true;
    }
    if (finding.layer === "entropy" && /^[A-Za-z]+(?:[ -][A-Za-z0-9]+)*$/.test(value)) {
      return true;
    }
    return false;
  }

  function getActionableFindings(findings) {
    return findings.filter((finding) => rank(finding.severity) >= rank(MEDIUM)).sort(compareFindings);
  }

  function getHighestSeverity(findings) {
    return findings.reduce((highest, finding) => (rank(finding.severity) > rank(highest) ? finding.severity : highest), findings.length ? LOW : NONE);
  }

  function getDisplayItems(findings) {
    return getActionableFindings(findings).slice(0, 2).map((finding) => ({
      label: displayType(finding),
      preview: preview(finding),
      replacement: getReplacementSuggestion(finding)
    }));
  }

  function buildCompactSummary(findings) {
    const actionable = getActionableFindings(findings);
    if (!actionable.length) {
      return "";
    }
    const counts = new Map();
    actionable.forEach((finding) => {
      const label = summaryLabel(finding);
      counts.set(label, (counts.get(label) || 0) + 1);
    });
    return [...counts.entries()].slice(0, 2).map(([label, count]) => `${count} ${count === 1 ? label : `${label}s`}`).join(", ");
  }

  function toPublicFindings(findings) {
    return getActionableFindings(findings).map((finding) => ({
      type: displayType(finding),
      severity: finding.severity,
      reason: finding.reason,
      preview: preview(finding),
      replacement: getReplacementSuggestion(finding),
      mask: getMaskSuggestion(finding)
    }));
  }

  function buildSignature(findings) {
    return findings.map((finding) => [finding.type, finding.severity, finding.start, finding.end, finding.match, finding.replacementKey || ""].join("|")).join("||");
  }

  function sanitizeText(text, findings, mode) {
    const actionable = getActionableFindings(findings).filter((finding) => Number.isInteger(finding.start) && Number.isInteger(finding.end)).sort((a, b) => b.start - a.start);
    let sanitized = text;
    let blockedStart = Number.POSITIVE_INFINITY;
    actionable.forEach((finding) => {
      if (finding.end > blockedStart) {
        return;
      }
      const replacement = mode === "replace" ? getReplacementSuggestion(finding) : getMaskSuggestion(finding);
      sanitized = sanitized.slice(0, finding.start) + replacement + sanitized.slice(finding.end);
      blockedStart = finding.start;
    });
    return sanitized;
  }

  function maskSensitiveText(text, findings) {
    return sanitizeText(text, findings, "mask");
  }

  function replaceSensitiveText(text, findings) {
    return sanitizeText(text, findings, "replace");
  }

  function runSelfTests(options = {}) {
    const silent = Boolean(options.silent);
    const previousLearnedSecrets = learnedSecrets.slice();
    const results = TEST_CASES.map((testCase) => {
      if (Array.isArray(testCase.setupLearnedSecrets)) {
        setLearnedSecrets(testCase.setupLearnedSecrets);
      } else {
        setLearnedSecrets([]);
      }
      const findings = detectSensitiveData(testCase.input);
      const highest = getHighestSeverity(findings);
      const actionable = getActionableFindings(findings);
      const severityPassed = testCase.expectedSeverities.includes(highest);
      const typePassed = !testCase.expectedTypes || testCase.expectedTypes.every((type) => findings.some((finding) => finding.type === type));
      const reasonPassed = !testCase.expectedReasons || testCase.expectedReasons.every((reason) => findings.some((finding) => String(finding.reason || "").includes(reason)));
      const countPassed = !Number.isInteger(testCase.expectedMinActionable) || actionable.length >= testCase.expectedMinActionable;
      const replaceResult = testCase.replaceExpected ? replaceSensitiveText(testCase.input, findings) : null;
      const replacePassed = !testCase.replaceExpected || replaceResult === testCase.replaceExpected;
      const passed = severityPassed && typePassed && reasonPassed && countPassed && replacePassed;
      if (!silent && !passed) {
        console.error("SafePromptDetector self-test failed", { testCase, highest, findings, actionableCount: actionable.length, replaceResult });
      }
      return { name: testCase.name, passed, highestSeverity: highest, findings, actionableCount: actionable.length, replaceResult };
    });
    setLearnedSecrets(previousLearnedSecrets);
    return results;
  }

  function runConsoleTestHarness(options = {}) {
    const results = runSelfTests(options);
    const passed = results.filter((result) => result.passed).length;
    const failed = results.length - passed;
    console.groupCollapsed(`[SafePrompt Guard] detector tests: ${passed}/${results.length} passed`);
    results.forEach((result) => {
      const method = result.passed ? "log" : "error";
      console[method](`[${result.passed ? "PASS" : "FAIL"}] ${result.name}`, {
        highestSeverity: result.highestSeverity,
        actionableCount: result.actionableCount,
        findings: result.findings.map((finding) => ({
          type: finding.type,
          severity: finding.severity,
          reason: finding.reason,
          replacement: finding.replacement
        })),
        replaceResult: result.replaceResult
      });
    });
    console.log("Summary", { passed, failed, rulesSource: lastRulesSource, lastLoadError });
    console.groupEnd();
    return { passed, failed, results, rulesSource: lastRulesSource, lastLoadError };
  }

  function enrich(finding) {
    return { ...finding, preview: preview(finding), displayType: displayType(finding), replacement: getReplacementSuggestion(finding), mask: getMaskSuggestion(finding) };
  }

  function normalizeLearnedSecrets(entries) {
    const list = Array.isArray(entries) ? entries : [];
    return list
      .map((entry) => normalizeLearnedSecretEntry(entry))
      .filter(Boolean);
  }

  function normalizeLearnedSecretEntry(entry) {
    if (!entry || typeof entry !== "object") {
      return null;
    }
    const value = typeof entry.value === "string" ? entry.value : "";
    const type = normalizeLearnedSecretType(entry.type);
    if (!value || !type) {
      return null;
    }
    return {
      id: typeof entry.id === "string" ? entry.id : "",
      value,
      type,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : "",
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : ""
    };
  }

  function normalizeLearnedSecretType(value) {
    const next = String(value || "").trim().toLowerCase();
    return VALID_LEARNED_TYPES.includes(next) ? next : null;
  }

  function learnedConfig(type) {
    switch (type) {
      case "password":
        return { type: "Password", reason: "Saved local password", severity: HIGH, category: "secret", replacementKey: "password" };
      case "token":
        return { type: "Token", reason: "Saved local token", severity: HIGH, category: "secret", replacementKey: "token" };
      case "api_key":
        return { type: "API key", reason: "Saved local API key", severity: HIGH, category: "secret", replacementKey: "api_key" };
      case "internal_reference":
        return { type: "Internal reference", reason: "Saved local internal reference", severity: MEDIUM, category: "internal", replacementKey: "internal_reference" };
      default:
        return { type: "Secret", reason: "Saved local secret", severity: HIGH, category: "secret", replacementKey: "secret" };
    }
  }

  function normalizeStaticPasswordSource(source) {
    const next = source && typeof source === "object" ? source : {};
    const commonPasswords = normalizeStringSet(next.commonPasswords);
    const defaultPasswords = normalizeStringSet(next.defaultPasswords);
    const defaultCredentialPairs = normalizeDefaultCredentialPairs(next.defaultCredentialPairs);
    return {
      commonPasswords,
      defaultPasswords,
      defaultCredentialPairs,
      defaultCredentialPairIndex: new Set(defaultCredentialPairs.map((entry) => `${entry.username}\u0000${entry.password}`)),
      metadata: next.metadata && typeof next.metadata === "object" ? next.metadata : {}
    };
  }

  function normalizeStringSet(values) {
    return new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
  }

  function normalizeDefaultCredentialPairs(values) {
    return (Array.isArray(values) ? values : [])
      .map((entry) => {
        const username = String(entry?.username || "").trim();
        const password = String(entry?.password || "").trim();
        return username && password ? { username, password } : null;
      })
      .filter(Boolean);
  }

  function findExactMatchStarts(text, needle) {
    const starts = [];
    if (!needle) {
      return starts;
    }

    let fromIndex = 0;
    while (fromIndex <= text.length) {
      const nextIndex = text.indexOf(needle, fromIndex);
      if (nextIndex === -1) {
        break;
      }
      starts.push(nextIndex);
      fromIndex = nextIndex + Math.max(needle.length, 1);
    }
    return starts;
  }

  function getLineNumberAt(text, index) {
    if (typeof text !== "string" || index <= 0) {
      return 1;
    }
    return text.slice(0, index).split(/\r\n|\r|\n/).length;
  }

  function dedupe(findings) {
    const map = new Map();
    findings.forEach((finding) => {
      const key = [finding.start, finding.end, normalize(finding.match)].join("|");
      const existing = map.get(key);
      if (!existing || isBetterFinding(finding, existing)) {
        map.set(key, { ...finding });
      }
    });
    return [...map.values()].sort(compareFindings);
  }

  function layerPriority(finding) {
    switch (finding.layer) {
      case "static":
        return 90;
      case "learned":
        return 85;
      case "pattern":
        return 80;
      case "entropy":
        return 70;
      case "context":
        return 60;
      default:
        return 50;
    }
  }

  function isBetterFinding(nextFinding, currentFinding) {
    if (rank(nextFinding.severity) !== rank(currentFinding.severity)) {
      return rank(nextFinding.severity) > rank(currentFinding.severity);
    }
    if (layerPriority(nextFinding) !== layerPriority(currentFinding)) {
      return layerPriority(nextFinding) > layerPriority(currentFinding);
    }
    if (typePriority(nextFinding) !== typePriority(currentFinding)) {
      return typePriority(nextFinding) > typePriority(currentFinding);
    }
    return (nextFinding.riskyWords?.length || 0) > (currentFinding.riskyWords?.length || 0);
  }

  function buildOrgEntries() {
    return [
      ...rules.customerNames.map((term) => ({ term, type: "Customer name", replacementKey: "customer_name" })),
      ...rules.projectNames.map((term) => ({ term, type: "Project name", replacementKey: "project_name" })),
      ...rules.internalCodeNames.map((term) => ({ term, type: "Internal codename", replacementKey: "internal_codename" })),
      ...rules.productNames.map((term) => ({ term, type: "Product name", replacementKey: "product_name" }))
    ];
  }

  function normalizeRules(nextRules) {
    return {
      customerNames: uniqueList(nextRules.customerNames),
      projectNames: uniqueList(nextRules.projectNames),
      internalCodeNames: uniqueList(nextRules.internalCodeNames),
      productNames: uniqueList(nextRules.productNames),
      internalOnlyPhrases: uniqueList(nextRules.internalOnlyPhrases),
      allowlistedTerms: uniqueList(nextRules.allowlistedTerms).map((value) => value.toLowerCase()),
      riskyContextWords: uniqueList(nextRules.riskyContextWords).map((value) => value.toLowerCase())
    };
  }

  function mergeRules(baseRules, nextRules) {
    const next = nextRules || {};
    return {
      customerNames: mergeList(baseRules.customerNames, next.customerNames),
      projectNames: mergeList(baseRules.projectNames, next.projectNames),
      internalCodeNames: mergeList(baseRules.internalCodeNames, next.internalCodeNames),
      productNames: mergeList(baseRules.productNames, next.productNames),
      internalOnlyPhrases: mergeList(baseRules.internalOnlyPhrases, next.internalOnlyPhrases),
      allowlistedTerms: mergeList(baseRules.allowlistedTerms, next.allowlistedTerms),
      riskyContextWords: mergeList(baseRules.riskyContextWords, next.riskyContextWords)
    };
  }

  function mergeList(baseList, nextList) {
    return [...new Set([...(Array.isArray(baseList) ? baseList : []), ...(Array.isArray(nextList) ? nextList : [])])];
  }

  function uniqueList(value) {
    return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))];
  }

  function validateRulesObject(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("org_rules.json must contain a JSON object.");
    }

    const validated = {};
    const listKeys = ["customerNames", "projectNames", "internalCodeNames", "productNames", "internalOnlyPhrases", "allowlistedTerms", "riskyContextWords"];

    listKeys.forEach((key) => {
      if (value[key] === undefined) {
        return;
      }
      if (!Array.isArray(value[key])) {
        throw new Error(`org_rules.json field "${key}" must be an array.`);
      }
      validated[key] = value[key];
    });

    return validated;
  }

  function keywordInfo(keyword) {
    const normalized = normalize(keyword);
    if (normalized.includes("pass")) return { type: "Password", replacementKey: "password" };
    if (normalized.includes("api")) return { type: "API key", replacementKey: "api_key" };
    if (normalized.includes("token")) return { type: "Token", replacementKey: "token" };
    return { type: "Secret", replacementKey: "secret" };
  }

  function replacementKeyForFinding(finding) {
    if (finding.replacementKey) {
      return finding.replacementKey;
    }
    switch (finding.type) {
      case "Password":
        return "password";
      case "Token":
      case "JWT":
      case "GitHub token":
      case "High entropy token or API key":
        return "token";
      case "API key":
      case "OpenAI key":
      case "AWS key":
        return "api_key";
      case "Connection string":
        return "connection_string";
      case "Private key":
        return "private_key";
      case "Email address":
        return "email";
      case "Internal IP address":
        return "internal_ip";
      case "Internal URL":
        return "internal_url";
      case "Internal host":
        return "internal_host";
      case "Account name":
        return "account_name";
      case "Environment name":
        return "environment_name";
      case "Resource identifier":
        return "resource_identifier";
      case "Access target":
        return "access_target";
      case "Customer name":
        return "customer_name";
      case "Project name":
        return "project_name";
      case "Internal codename":
        return "internal_codename";
      case "Product name":
        return "product_name";
      case "Internal reference":
        return "internal_reference";
      default:
        return "secret";
    }
  }

  function findMatches(text, phrase) {
    const pattern = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, "gi");
    const matches = [];
    let match;
    while ((match = pattern.exec(text)) !== null) {
      matches.push({ start: match.index, end: match.index + match[0].length, match: match[0] });
    }
    return matches;
  }

  function riskyWordsNear(text, start, end) {
    const segment = text.slice(Math.max(0, start - CONTEXT_RADIUS), Math.min(text.length, end + CONTEXT_RADIUS)).toLowerCase();
    return rules.riskyContextWords.filter((word) => new RegExp(`\\b${escapeRegExp(word)}\\b`, "i").test(segment));
  }

  function nearby(left, right, maxGap) {
    if (left.end < right.start) return right.start - left.end <= maxGap;
    if (right.end < left.start) return left.start - right.end <= maxGap;
    return true;
  }

  function looksLikePassword(value) {
    return value.length >= 8 && value.length <= 64 && /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value) && /[!@#$%^&*+=?]/.test(value) && !isIpv4(value) && !isUrl(value) && !isFilePath(value) && !isVersion(value) && !/^[A-Fa-f0-9]{32,}$/.test(value) && !isMachine(value);
  }

  function preview(finding) {
    const value = collapseWhitespace(finding.match);
    const type = displayType(finding);
    if (type === "Project" || type === "Customer" || type === "Internal" || type === "Environment" || type === "Account" || type === "Identifier") {
      return value.length <= 12 ? value : `${value.slice(0, 6)}...`;
    }
    if (type === "URL" || type === "Host" || type === "Access") {
      return value.length <= 14 ? value : `${value.slice(0, 8)}...${value.slice(-4)}`;
    }
    if (type === "IP") {
      return value;
    }
    if (type === "Password") return value.length <= 5 ? `${value[0]}...` : `${value.slice(0, 4)}...${value.slice(-1)}`;
    if (type === "Email") {
      const [localPart = "", domainPart = ""] = value.split("@");
      const domainSuffix = domainPart ? domainPart.slice(-3) : value.slice(-3);
      return `${localPart.slice(0, 4)}...${domainSuffix}`;
    }
    return value.length <= 8 ? `${value.slice(0, 4)}...` : `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  function displayType(finding) {
    switch (finding.type) {
      case "Password":
        return "Password";
      case "Email address":
        return "Email";
      case "Internal IP address":
        return "IP";
      case "Internal URL":
        return "URL";
      case "Internal host":
        return "Host";
      case "Account name":
        return "Account";
      case "Environment name":
        return "Environment";
      case "Resource identifier":
        return "Identifier";
      case "Access target":
        return "Access";
      case "API key":
      case "OpenAI key":
      case "AWS key":
        return "API key";
      case "Connection string":
        return "Connection string";
      case "Private key":
        return "Private key";
      case "Customer name":
        return "Customer";
      case "Project name":
        return "Project";
      case "Internal codename":
      case "Product name":
      case "Internal reference":
        return "Internal";
      default:
        if (finding.type.includes("token") || finding.type.includes("key") || finding.type === "JWT") {
          return "Token";
        }
        return "Secret";
    }
  }

  function summaryLabel(finding) {
    switch (displayType(finding)) {
      case "Password":
        return "password";
      case "Token":
        return "token";
      case "API key":
        return "api key";
      case "Email":
        return "email";
      case "IP":
        return "ip";
      case "URL":
        return "url";
      case "Host":
        return "host";
      case "Account":
        return "account";
      case "Environment":
        return "environment";
      case "Identifier":
        return "identifier";
      case "Access":
        return "access target";
      case "Project":
        return "project";
      case "Customer":
        return "customer";
      case "Internal":
        return "internal reference";
      case "Connection string":
        return "connection string";
      case "Private key":
        return "private key";
      default:
        return "secret";
    }
  }

  function getReplacementSuggestion(finding) {
    const key = replacementKeyForFinding(finding);
    return REPLACEMENT_TEMPLATES[key] || "[REDACTED]";
  }

  function getMaskSuggestion(finding) {
    const key = replacementKeyForFinding(finding);
    return MASK_TEMPLATES[key] || "[MASKED]";
  }

  function isSecret(finding) {
    return SECRET_TYPES.has(finding.type);
  }

  function rank(severity) {
    if (severity === HIGH) return 3;
    if (severity === MEDIUM) return 2;
    if (severity === LOW) return 1;
    return 0;
  }

  function typePriority(finding) {
    switch (finding.type) {
      case "Private key":
        return 110;
      case "Password":
        return 105;
      case "Connection string":
        return 100;
      case "OpenAI key":
      case "AWS key":
        return 95;
      case "API key":
        return 90;
      case "GitHub token":
      case "JWT":
        return 88;
      case "High entropy token or API key":
      case "Token":
        return 85;
      case "Email address":
        return 70;
      case "Internal IP address":
        return 68;
      case "Internal URL":
        return 67;
      case "Internal host":
        return 66;
      case "Access target":
        return 65;
      case "Account name":
        return 64;
      case "Environment name":
        return 63;
      case "Resource identifier":
        return 62;
      case "Customer name":
      case "Project name":
      case "Internal codename":
      case "Product name":
      case "Internal reference":
        return 40;
      default:
        return 60;
    }
  }

  function compareFindings(left, right) {
    if (rank(right.severity) !== rank(left.severity)) {
      return rank(right.severity) - rank(left.severity);
    }
    if (Number(isSecret(right)) !== Number(isSecret(left))) {
      return Number(isSecret(right)) - Number(isSecret(left));
    }
    if (typePriority(right) !== typePriority(left)) {
      return typePriority(right) - typePriority(left);
    }
    return left.start - right.start;
  }

  function calculateShannonEntropy(value) {
    const counts = new Map();
    for (const char of value) counts.set(char, (counts.get(char) || 0) + 1);
    let entropy = 0;
    for (const count of counts.values()) {
      const probability = count / value.length;
      entropy -= probability * Math.log2(probability);
    }
    return entropy;
  }

  function collapseWhitespace(value) {
    return String(value).replace(/\s+/g, " ").trim();
  }

  function normalize(value) {
    return collapseWhitespace(value).toLowerCase();
  }

  function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function isIpv4(value) {
    return /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value);
  }

  function isUrl(value) {
    return /^(https?:\/\/|ftp:\/\/|www\.)/i.test(value);
  }

  function isFilePath(value) {
    return /^(?:[A-Za-z]:\\|\\\\|\/)/.test(value) || /[\\/].+\.[A-Za-z0-9]{1,6}$/.test(value);
  }

  function isHostname(value) {
    return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9-]{1,63})+$/i.test(value);
  }

  function isVersion(value) {
    return /^v?\d+(?:\.\d+){1,4}(?:[-_A-Za-z0-9]+)?$/i.test(value);
  }

  function isPort(value) {
    if (!/^\d{1,5}$/.test(value)) return false;
    const port = Number(value);
    return port >= 1 && port <= 65535;
  }

  function isMachine(value) {
    return /^[A-Za-z0-9._-]{3,64}$/.test(value) && !/[!@#$%^&*+=?]/.test(value) && /[-_]/.test(value);
  }

  function looksLikeAssignmentFragment(value) {
    return /^[A-Za-z][A-Za-z0-9._-]{1,64}[=:][A-Za-z0-9._/-]{2,}$/i.test(value);
  }

  function isPrivateIpv4(value) {
    if (!isIpv4(value)) {
      return false;
    }
    if (/^10\./.test(value) || /^192\.168\./.test(value) || /^127\./.test(value)) {
      return true;
    }
    return /^172\.(1[6-9]|2\d|3[0-1])\./.test(value);
  }

  function isInternalUrl(value) {
    try {
      const url = new URL(value);
      return isInternalHost(url.host || url.hostname);
    } catch (error) {
      return false;
    }
  }

  function isInternalHost(value) {
    const host = stripPort(String(value || "").trim());
    if (!host) {
      return false;
    }
    if (isPrivateIpv4(host)) {
      return true;
    }
    return /(^|\.)internal(\.|$)/i.test(host) || /\.local$/i.test(host) || /\.internal$/i.test(host);
  }

  function stripPort(value) {
    if (isIpv4(value)) {
      return value;
    }
    return String(value || "").replace(/:\d{2,5}$/, "");
  }

  function isEmbeddedInUrl(text, start) {
    return text.slice(Math.max(0, start - 3), start) === "://";
  }

  function isEmbeddedInEmail(text, start) {
    return text[start - 1] === "@";
  }

  function looksLikeCredentialedUri(value) {
    return /^[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/i.test(value);
  }

  function containsInternalAddress(value) {
    return /(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+(?::\d{2,5})?)/i.test(value);
  }

  const api = {
    initialize,
    setLearnedSecrets,
    detectSensitiveData,
    getActionableFindings,
    getHighestSeverity,
    getDisplayItems,
    buildCompactSummary,
    buildSignature,
    toPublicFindings,
    sanitizeText,
    maskSensitiveText,
    replaceSensitiveText,
    getReplacementSuggestion,
    getMaskSuggestion,
    calculateShannonEntropy,
    runSelfTests,
    runConsoleTestHarness,
    replacementTemplates: REPLACEMENT_TEMPLATES,
    testCases: TEST_CASES,
    getOrgRules: () => rules,
    getLearnedSecrets: () => learnedSecrets.slice(),
    getStaticPasswordSource: () => ({
      commonPasswordCount: STATIC_PASSWORD_SOURCE.commonPasswords.size,
      defaultPasswordCount: STATIC_PASSWORD_SOURCE.defaultPasswords.size,
      defaultCredentialPairCount: STATIC_PASSWORD_SOURCE.defaultCredentialPairs.length,
      metadata: STATIC_PASSWORD_SOURCE.metadata
    }),
    getDiagnostics: () => ({
      lastLoadError,
      lastRulesSource,
      lastLearnedLoadError,
      lastLearnedSource,
      learnedSecretCount: learnedSecrets.length,
      selfTestCount: TEST_CASES.length,
      staticCommonPasswordCount: STATIC_PASSWORD_SOURCE.commonPasswords.size,
      staticDefaultPasswordCount: STATIC_PASSWORD_SOURCE.defaultPasswords.size,
      staticDefaultCredentialPairCount: STATIC_PASSWORD_SOURCE.defaultCredentialPairs.length
    })
  };

  initialize().finally(() => {
    if (lastLoadError) {
      console.warn("SafePromptDetector org rules fallback active", {
        lastLoadError,
        lastRulesSource
      });
    }
    const results = runSelfTests({ silent: true });
    if (results.some((result) => !result.passed)) {
      console.error("SafePromptDetector self-tests failed", results);
    }
  });

  global.SafePromptDetector = api;
})(globalThis);
