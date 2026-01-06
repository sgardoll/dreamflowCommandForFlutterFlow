# AGENTS.md - FlutterFlow Custom Code Command

## Project Overview

AI-powered code generation for FlutterFlow-compatible Dart artifacts. Three-step pipeline: **Prompt Architect** → **Code Generator** → **Code Dissector**.

Core constraint: FlutterFlow has rigid architectural requirements that generic AI violates. This tool embeds those constraints into every step.

---

## Build & Development Commands

```bash
npm install              # Install dependencies
npm run dev              # Start dev server (port 3000)
npm run build            # Build for production
npm run preview          # Preview production build
node --check app.js      # Syntax check (no test suite)
```

### Environment Setup

Create `.env` in project root:
```env
VITE_GEMINI_API_KEY=your_key_here
VITE_ANTHROPIC_API_KEY=optional
VITE_OPENAI_API_KEY=optional
```

---

## Architecture

### File Structure
```
├── index.html      # UI structure, Tailwind styles, templates
├── app.js          # All application logic (single file)
├── vite.config.js  # Dev server, API proxies
├── .env            # API keys (gitignored)
```

### Core Pipeline Functions (app.js)
| Function | Purpose | Output |
|----------|---------|--------|
| `runPromptArchitect()` | Analyzes user input | JSON spec |
| `runCodeGenerator()` | JSON spec → code | Dart code |
| `runCodeDissector()` | Audits for FF issues | Markdown report |

### API Pattern
```javascript
const url = `/api/gemini/v1beta/models/${modelId}:generateContent`;
try {
  result = await callGemini(prompt, systemInstruction, PRIMARY_MODEL);
} catch (error) {
  result = await callGemini(prompt, systemInstruction, FALLBACK_MODEL);
}
```

---

## Code Style Guidelines

### Naming Conventions
| Type | Convention | Example |
|------|------------|---------|
| Constants | UPPER_SNAKE_CASE | `PROMPT_ARCHITECT_MODEL` |
| Functions | camelCase | `runCodeGenerator` |
| Variables | camelCase | `pipelineState` |
| HTML IDs | kebab-case | `main-stage` |

### JavaScript Style
- No semicolons at line ends
- Template literals for string interpolation
- Async/await over raw promises
- Const over let, avoid var

### Error Handling
```javascript
async function example() {
  try {
    const result = await callGemini(prompt, instruction);
    return result;
  } catch (error) {
    console.error("FunctionName failed:", error);
    throw error;
  }
}
```
- Always wrap async operations in try/catch
- Log errors with context using function name
- Implement fallback logic for API calls

---

## FlutterFlow-Specific Rules

**CRITICAL:** Preserve these constraints in system instructions:

### Forbidden Patterns (Code Generator must NOT output)
- `void main()` or `main()` function
- `runApp()`, `MaterialApp`, `Scaffold`
- Any `import` statements (FlutterFlow manages imports)
- Custom Dart classes for data models (use FF Structs)

### Required Patterns (Code Generator MUST include)
- `width` and `height` parameters for Custom Widgets
- Null safety with `??` and `?.` operators
- `FlutterFlowTheme.of(context)` for colors
- `Future<dynamic> Function()?` for action callbacks
- Proper `dispose()` for controllers

### The Three Artifact Types
| Type | Constraints |
|------|-------------|
| Custom Function | Sync only, NO external packages, pure Dart |
| Custom Action | Must return `Future<T>`, external packages OK |
| Custom Widget | Must handle null width/height, use LayoutBuilder |

---

## Adding Features

### New Pipeline Step
1. Create `async function runNewStep()` in app.js
2. Add systemInstruction with FlutterFlow constraints
3. Wire into `runThinkingPipeline()`, add UI in index.html

### Modifying System Instructions
1. Locate: `runPromptArchitect`, `runCodeGenerator`, or `runCodeDissector`
2. Edit the `systemInstruction` template literal
3. **Preserve FlutterFlow constraints** - non-negotiable

---

## Dependencies

- **Runtime:** None (vanilla JS)
- **Build:** Vite 5.x
- **CDN:** Tailwind CSS, Highlight.js, Google Fonts
- **APIs:** Gemini (required), Claude/OpenAI (optional)
