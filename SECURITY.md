# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please report it responsibly.

**Email:** Open a private security advisory via [GitHub Security Advisories](https://github.com/tradesdontlie/tradingview-mcp/security/advisories/new).

**Do not** open a public issue for security vulnerabilities.

## Scope

This project connects to a locally running TradingView Desktop instance via Chrome DevTools Protocol on `localhost:9222`. Security concerns in scope include:

- Code injection via crafted tool inputs
- Unintended data exposure through tool outputs
- Credential or session token leakage
- Vulnerabilities in the MCP server or CLI that could be exploited locally

## Out of Scope

- TradingView's own security (report to TradingView directly)
- Chrome DevTools Protocol security (report to Google/Chromium)
- Claude Code or MCP SDK security (report to Anthropic)

## Arbitrary Code Execution by Design

Most tools sanitize their inputs before injecting them into the page (string
arguments are JSON-escaped via `safeString`, numeric arguments validated via
`requireFinite`). The **`ui_evaluate`** tool is a deliberate exception: it
evaluates the caller's JavaScript expression verbatim in the TradingView page
context, with no escaping. This is an intentional escape hatch for advanced
automation — treat its input as fully trusted, and prefer a dedicated tool
whenever one exists.

## Best Practices for Users

- Only run TradingView with `--remote-debugging-port=9222` on localhost
- Do not expose port 9222 to your network or the internet
- Do not pipe `tv stream` output to external services without reviewing the data
- Keep your TradingView Desktop and Node.js installations up to date
