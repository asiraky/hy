# Contributing to hy

Thanks for helping improve hy.

## Before opening a change

- Search existing issues and pull requests to avoid duplicate work.
- Open an issue before undertaking a large feature or protocol change.
- Keep changes focused and include tests for observable behavior.
- Never include credentials, local databases, generated binaries, or user data.

## Development

Requirements are Go 1.25+, Node.js 18+, and npm.

```bash
npm install
npm test
npm run build
```

Use `npm run dev` for the Go and Vite development servers. Run `gofmt` on Go
changes. Pull requests must pass the race-enabled Go suite and TypeScript check.

## Pull requests

Fork the repository, create a focused branch, and open a pull request against
`main`. Explain the failure or requirement being addressed and how the result
was verified. The maintainer may ask for changes before merging.

By contributing, you agree that your contribution is licensed under the MIT
License that covers this repository.
