# pi-fireworks

Deprecated: Pi now has native support for Fireworks.ai.

An extension for [pi](https://github.com/badlogic/pi-mono/) that adds Fireworks AI as a provider.

Please note: This has been highly vibe coded by pi itself.

## What it does

- Registers a `fireworks` provider in pi
- Reads a cached Fireworks model list from `~/.pi/agent/fireworks-models-cache.json`
- Adds `/fireworks-refresh` to fetch the latest chat-capable models from the Fireworks API
- Injects two kinds of known-available models when Fireworks does not return them in the API listing:
  - **fire pass** models: subscription/router models such as Kimi K2.5 Turbo
  - **forced models**: known available models such as Kimi K2.6
- Supports `FIREWORKS_API_KEY` or `~/.pi/agent/auth.json`

## Install

### From npm

```bash
pi install npm:pi-fireworks
```

### From git

```bash
pi install git:github.com/denniseijpe/pi-fireworks
```

### From a local checkout

```bash
pi install /absolute/path/to/pi-fireworks
```

## Configure authentication

### Option 1: environment variable

```bash
export FIREWORKS_API_KEY=fw_...
```

### Option 2: `~/.pi/agent/auth.json`

```json
{
  "fireworks": {
    "type": "api_key",
    "key": "fw_..."
  }
}
```

## Usage

Start pi, then fetch the latest models using `/fireworks-refresh` and pick a model with `/model`.

### Commands

- `/fireworks-refresh` — fetch the latest Fireworks model list and update the local cache

## Cache files

The package stores its model cache in the pi directory:

- `~/.pi/agent/fireworks-models-cache.json`
- `~/.pi/agent/fireworks-models-response.json`

## License

MIT
