# MaxQ

A data flow engine for orchestrating multi-stage workflows with DAG-based step execution.

## Quick Start

### Local Development

```bash
# Clone and build
git clone https://github.com/codespin-ai/maxq.git
cd maxq
./scripts/install-deps.sh  # Optional - build.sh does this automatically
./scripts/build.sh

# Start server
./scripts/start.sh
```

## Development Commands

```bash
./scripts/install-deps.sh           # Install dependencies for all packages
./scripts/install-deps.sh --force   # Force reinstall all dependencies
./scripts/build.sh                  # Build all packages (includes dependency installation)
./scripts/build.sh --install        # Build with forced dependency reinstall
./scripts/clean.sh                  # Remove build artifacts and node_modules
./scripts/lint-all.sh               # Run ESLint
./scripts/format-all.sh             # Format with Prettier, called automatically during build
npm test                            # Run all tests
npm run test:grep -- "pattern"      # Search tests
```

## Documentation

- [Complete Specification](docs/specification.md) - HTTP API, database schema, workflow examples
- [Coding Standards](CODING-STANDARDS.md) - Development guidelines and patterns
- [Examples](docs/examples/) - Working example workflows
