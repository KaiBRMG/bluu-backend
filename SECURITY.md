# Objective

Conduct a deep-dive security analysis of the provided codebase specifically focused on Access Control and Authorization logic.

# Task 

Please analyze the code for the following:

- Broken Function Level Authorization (BFLA): Identify endpoints that lack proper role checks, especially those performing sensitive administrative actions.

- Broken Object Level Authorization (BOLA/IDOR): Check if a user can access or modify resources belonging to another user by manipulating IDs (e.g., GET /api/orders/123).

- Privilege Escalation: Look for logic flaws where a standard user might upgrade their own permissions or bypass a "paywall" feature.

- Inconsistent Enforcement: Identify if authorization is handled inconsistently (e.g., enforced in the API layer but missing in internal service calls or background jobs).

- Hardcoded Credentials/Roles: Flag any hardcoded admin keys or "god-mode" flags.

Output Requirements:

- Summary Table: List each vulnerability found, its severity (Critical/High/Medium/Low), and the specific file/line number.

- Detailed Breakdown: For every "Critical" or "High" finding, explain the attack vector and provide a "Secure Code" snippet to fix it.

- Strategic Advice: Suggest one architectural improvement to centralize authorization (e.g., moving to a Middleware or a Policy-as-Code engine).

# Rules

There are 2 interfaces into the system: employee side (users collection) via electron, and the creator portal (creators collection).

User (employee) permissions are found by checking which pages are shared to the particular user. Users must have read and write access to any data on that page if shared to them.

Creators only have read/write access to data pertaining to them on their portal.

# Considerations

API routes are very messy. For example creator display names and pictures are called in the disputes API. Investigate the usage of API in relation to access control.