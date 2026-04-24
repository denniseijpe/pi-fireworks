# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-04-24

### Changed

- Added deprecation notice. Pi now has native support for Fireworks.ai.

## [0.1.1] - 2026-04-21

### Added

- Automatic injection of known-available models missing from the Fireworks API listing:
  - **fire pass** variant for subscription/router models (e.g., `accounts/fireworks/routers/kimi-k2p5-turbo`).
  - **forced** variant for known models not exposed by the API (e.g., `accounts/fireworks/models/kimi-k2p6`).

### Removed

- `/fireworks` info command
