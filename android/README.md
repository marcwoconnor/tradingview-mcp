# ChartMind — TradingView from your Android phone, with Claude built in

ChartMind is a native Android (Kotlin/Compose) app that lets you **chat with Claude
about your live TradingView Desktop chart from your phone**. Claude can read your
chart, change symbols/timeframes, add indicators, run backtests, take screenshots,
and more — using the same 84 tools the desktop MCP exposes.

It's the **"remote brain"** design: the phone runs the Claude agent loop and talks to
a small bridge on your computer, which drives TradingView. Your chart, data feed, and
Pine engine all stay on TradingView — nothing is re-implemented.

```
 Android app (Claude chat + tool loop)  ──HTTPS──▶  api.anthropic.com   (the LLM)
            │
            └──────────────  HTTP + token  ─────────▶  tv-bridge ──CDP──▶ TradingView Desktop
                                                       (on your computer)
```

## Part 1 — Run the bridge on your computer

The bridge ships in this repo (`src/bridge/`). On the machine running TradingView Desktop:

```bash
# 1. TradingView Desktop must be running with CDP enabled (port 9222).
#    Use the existing helper if needed:  npm run tv -- launch   (or `tv launch`)

# 2. Pick a shared token and start the bridge:
export TV_BRIDGE_TOKEN="choose-a-long-random-string"
npm run bridge          # listens on 0.0.0.0:9333

# (If you don't set TV_BRIDGE_TOKEN, the bridge generates one and prints it.)
```

Endpoints: `GET /health`, `GET /tools`, `POST /call`, `GET /file` — all (except `/health`)
require `Authorization: Bearer $TV_BRIDGE_TOKEN`.

### Reaching it from your phone

- **Same Wi-Fi (home):** point the app at `http://<computer-LAN-ip>:9333`
  (find it with `ipconfig` / `ifconfig` / `ip addr`).
- **Anywhere (recommended):** install [Tailscale](https://tailscale.com) on both the
  computer and the phone (free for personal use). Then use the computer's Tailscale IP,
  e.g. `http://100.x.y.z:9333`, and it works on cellular too — no port forwarding, and
  the link is encrypted by the VPN.

> The bridge speaks plain HTTP (no TLS cert on a home box). Only expose it on networks
> you trust — your LAN or a private VPN like Tailscale. The bearer token is the gate.

## Part 2 — Build & run the app

Requirements: **Android Studio** (Ladybug or newer) with an Android SDK; a device or
emulator on API 26+.

```bash
# Open the `android/` folder in Android Studio and let it sync, OR from the CLI:
cd android
./gradlew assembleDebug          # builds app/build/outputs/apk/debug/app-debug.apk
./gradlew installDebug           # install to a connected device/emulator
```

> This repo was scaffolded in an environment without the Android SDK, so the APK has
> not been built here — open it in Android Studio (which you have) to compile and run.

### Configure (in-app Settings ⚙)

| Field | Value |
|---|---|
| **Anthropic API key** | your `sk-ant-…` key (from console.anthropic.com) |
| **Model** | `claude-opus-4-8` (default), or Sonnet/Haiku |
| **Adaptive thinking** | on = deeper analysis, slightly slower |
| **Bridge URL** | `http://<lan-or-tailscale-ip>:9333` |
| **Bridge token** | the `TV_BRIDGE_TOKEN` from Part 1 |

Tap **Save & test** — you should see "Connected • 84 tools available".

## Using it

Just chat. Examples:
- "What's on my chart right now?"
- "Switch to NQ1! on the 15-minute and add RSI — is it overbought?"
- "Screenshot the chart and summarize the price action."
- "Run the strategy tester and give me the max drawdown and win rate."

Claude decides which tools to call; you'll see each tool call inline (with its result),
and screenshots render right in the conversation.

## Architecture (for developers)

```
com.chartmind
├── MainActivity.kt            # Compose entry, chat ↔ settings navigation
├── data/Settings.kt           # DataStore-backed settings
├── bridge/BridgeClient.kt     # OkHttp client for tv-bridge (/tools, /call, /file)
├── llm/
│   ├── LlmClient.kt           # interface (swappable backend)
│   └── AnthropicRestClient.kt # Anthropic Messages API over OkHttp + kotlinx.serialization
├── agent/
│   ├── AgentEngine.kt         # the tool-use loop (Claude ⇄ bridge)
│   └── SystemPrompt.kt
└── ui/                        # ChatViewModel + Compose screens/components
```

- **Tools are discovered, not hardcoded.** The app fetches the tool list from the
  bridge's `/tools`, so any tool added to the MCP server is instantly available — no
  app update needed.
- **LLM backend is behind `LlmClient`.** The default is a raw-HTTPS Anthropic client
  (chosen for Android reliability); an Anthropic-SDK-backed implementation can drop in
  behind the same interface without touching the agent loop.
- Conversation content is kept as raw JSON so assistant `thinking` blocks round-trip
  back to the API unmodified during multi-turn tool use.

## Notes

- Unofficial. Not affiliated with TradingView Inc. or Anthropic. Ensure your usage
  complies with TradingView's Terms of Use.
- Your Anthropic key and bridge token are stored only on-device (DataStore).
