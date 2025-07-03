# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Build and Development
- `npm run compile` - Compile TypeScript and run linting
- `npm run compile-standalone` - Compile for standalone distribution
- `npm run watch` - Watch mode for development (runs esbuild and tsc in parallel)
- `npm run package` - Production build with all checks
- `npm run dev:webview` - Start webview development server

### Testing
- `npm run test` - Run all tests (unit + integration)
- `npm run test:unit` - Run unit tests with Mocha
- `npm run test:integration` - Run VS Code extension integration tests
- `npm run test:ci` - Run tests in CI environment
- `npm run test:webview` - Run webview tests

### Code Quality
- `npm run lint` - Run ESLint on source and webview code
- `npm run format` - Check code formatting with Prettier
- `npm run format:fix` - Fix code formatting with Prettier
- `npm run check-types` - Run TypeScript type checking

### Installation
- `npm run install:all` - Install dependencies for both extension and webview
- `npm run protos` - Build protocol buffers and generate server setup

### Release
- `npm run changeset` - Create changeset for version management
- `npm run version-packages` - Update package versions from changesets

## Architecture Overview

Cline is a VS Code extension that provides an AI coding assistant with autonomous capabilities. The architecture follows a clear separation of concerns:

### Core Structure
```
src/
├── extension.ts          # VS Code extension entry point
├── core/                 # Core functionality
│   ├── controller/       # Handles webview messages and orchestration
│   ├── task/            # Executes API requests and tool operations
│   ├── webview/         # Manages webview lifecycle
│   ├── context/         # Context management and tracking
│   ├── prompts/         # AI prompt construction
│   └── tools/           # Tool implementations
├── api/                 # API handlers for different AI providers
├── integrations/        # VS Code integrations (terminal, editor, etc.)
├── services/           # Standalone services (browser, search, etc.)
├── shared/             # Shared types and utilities
└── utils/              # Common utilities
```

### Key Components

**Extension Entry Point (`extension.ts`)**: Activates the extension, manages webview providers, and handles VS Code lifecycle.

**Controller (`core/controller/`)**: Central orchestrator that processes webview messages and coordinates between different subsystems using gRPC-like message handling.

**Task System (`core/task/`)**: Executes AI conversations, manages tool usage, and handles the main conversation loop with context management.

**Context Management (`core/context/`)**: Tracks file context, manages context windows, and provides intelligent context selection for AI interactions.

**Tool System (`core/tools/`)**: Implements available tools (bash, edit, read, write, grep, etc.) that the AI can use to interact with the codebase.

**API Layer (`api/`)**: Abstracts different AI providers (Anthropic, OpenAI, OpenRouter, etc.) with unified interfaces and streaming support.

**Integrations (`integrations/`)**: Provides deep VS Code integration including terminal management, editor interactions, browser automation, and checkpoint system.

## Key Technologies

- **TypeScript**: Primary language with strict type checking
- **VS Code API**: Extension development framework
- **Protocol Buffers**: For structured message passing
- **esbuild**: Fast bundling and compilation
- **React**: Webview UI framework
- **gRPC**: Internal communication protocol
- **Puppeteer**: Browser automation for Computer Use
- **Tree-sitter**: Code parsing and analysis

## Development Workflow

1. **Setup**: Run `npm run install:all` to install all dependencies
2. **Development**: Use `npm run watch` for continuous compilation during development
3. **Testing**: Run `npm run test` to execute full test suite
4. **Debugging**: Launch extension with F5 in VS Code for debugging
5. **Code Quality**: Run `npm run lint` and `npm run format` before committing
6. **Releases**: Use `npm run changeset` to document changes for version management

## Path Aliases

The codebase uses TypeScript path aliases configured in `tsconfig.json`:
- `@/*` → `src/*`
- `@api/*` → `src/api/*`
- `@core/*` → `src/core/*`
- `@integrations/*` → `src/integrations/*`
- `@services/*` → `src/services/*`
- `@shared/*` → `src/shared/*`
- `@utils/*` → `src/utils/*`

## Important Notes

- The extension supports both sidebar and tab-based webview modes
- Protocol buffer definitions are in `proto/` directory
- Webview UI is a separate React app in `webview-ui/`
- The extension can operate in standalone mode for non-VS Code environments
- All AI interactions go through the task system with proper context management
- The extension includes comprehensive telemetry and error reporting
- MCP (Model Context Protocol) support for extensible tool integration