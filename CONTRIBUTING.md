# Contributing

Thank you for your interest in contributing to STLorebookManipulator.

## Getting Started

1. Clone the repository into your SillyTavern extensions folder:
   ```bash
   git clone https://github.com/cspiritsong/STLorebookManipulator.git \
     data/<user-handle>/extensions/STLorebookManipulator
   ```
2. Reload SillyTavern (F5 or restart)
3. Enable **Lorebook Manipulator** in Extensions tab

No build step is required. The extension loads as a vanilla ES module.

## Project Structure

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full file-by-file breakdown and data flow.

## Running Tests

Tests are located in `tests/` and use a lightweight test runner compatible with browser environments. To run:

```bash
node tests/run-tests.js
```

Or open `tests/test-runner.html` in a browser for visual output.

All new features must include at least one test. All bug fixes must include a regression test.

## Code Style

- Vanilla JavaScript ES modules — no TypeScript, no bundler
- No external dependencies unless approved (see Dependency Rules in how-to-work-with-me.md)
- Functions should be small, focused, and named descriptively
- Error handling is mandatory for all async operations
- No hardcoded secrets, API keys, or personal data

## Making Changes

1. Create a branch: `feat/description`, `fix/description`, `docs/description`
2. Make your changes
3. Run tests: `node tests/run-tests.js`
4. Ensure no linting/formatting issues
5. Submit a pull request with a clear description of what changed and why

## Commit Messages

Use conventional commits:
```
feat: add side-by-side diff toggle
fix: prevent backup overwrite on simultaneous saves
docs: update ARCHITECTURE.md with new module
test: add regression test for empty lorebook handling
```

## Reporting Issues

Open a GitHub issue with:
- Steps to reproduce
- Expected vs actual behavior
- SillyTavern version and API backend used
- Screenshot if UI-related

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
