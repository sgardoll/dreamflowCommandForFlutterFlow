// --- CONFIGURATION ---
const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY || "";
const anthropicApiKey = import.meta.env.VITE_ANTHROPIC_API_KEY || "";
const openaiApiKey = import.meta.env.VITE_OPENAI_API_KEY || "";

// Model Configuration
const PROMPT_ARCHITECT_MODEL = "gemini-3-flash-preview";
const CODE_DISSECTOR_MODEL = "gemini-3-flash-preview";
const FALLBACK_MODEL = "gemini-2.5-flash-preview-09-2025";

// --- APP STATE ---
let pipelineState = {
  step1Result: null,
  step2Result: null,
  step3Result: null,
  currentStep: 0,
  isRunning: false,
};

// --- CORE API FUNCTIONS ---

async function checkConnection() {
  if (!geminiApiKey) {
    console.error("Gemini API Key not found. Check .env file for VITE_GEMINI_API_KEY");
    return false;
  }
  return true;
}

async function callGemini(
  prompt,
  systemInstruction,
  modelId = PROMPT_ARCHITECT_MODEL
) {
  // Use proxy to avoid CORS issues
  const url = `/api/gemini/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: {
      maxOutputTokens: 16384,
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini API Error:", response.status, errorText);
      throw new Error(`Gemini API failed: ${response.status}`);
    }

    const data = await response.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text;
  } catch (error) {
    console.error("Gemini call failed:", error);
    if (modelId !== FALLBACK_MODEL) {
      console.log("Trying fallback model...");
      return callGemini(prompt, systemInstruction, FALLBACK_MODEL);
    }
    throw error;
  }
}

async function callClaude(prompt, systemInstruction) {
  if (!anthropicApiKey) {
    throw new Error("Anthropic API key not found");
  }

  // Use proxy to avoid CORS issues
  const url = "/api/anthropic/v1/messages";
  const payload = {
    model: "claude-opus-4-5-20251101",
    max_tokens: 16384,
    system: systemInstruction,
    messages: [{ role: "user", content: prompt }],
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude API Error:", response.status, errorText);

      // Handle specific error types
      if (errorText.includes("image") || errorText.includes("media")) {
        throw new Error(
          "Claude API error: This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests."
        );
      }

      if (response.status === 401) {
        throw new Error(
          "Claude API authentication failed. Please check your Anthropic API key in the .env file."
        );
      }

      throw new Error(`Claude API failed: ${response.status}`);
    }

    const data = await response.json();
    return data.content?.[0]?.text;
  } catch (error) {
    console.error("Claude call failed:", error);
    throw error;
  }
}

async function callOpenAI(prompt, systemInstruction) {
  if (!openaiApiKey) {
    throw new Error("OpenAI API key not found");
  }

  // Use proxy to avoid CORS issues
  const url = "/api/openai/v1/chat/completions";
  const payload = {
    model: "gpt-5.2-codex",
    messages: [
      { role: "system", content: systemInstruction },
      { role: "user", content: prompt },
    ],
    max_tokens: 16384,
    temperature: 0.1,
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openaiApiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", response.status, errorText);

      // Handle specific error types
      if (
        errorText.includes("image") ||
        errorText.includes("vision") ||
        errorText.includes("media")
      ) {
        throw new Error(
          "OpenAI API error: This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests."
        );
      }

      if (response.status === 401) {
        throw new Error(
          "OpenAI API authentication failed. Please check your OpenAI API key in the .env file."
        );
      }

      throw new Error(`OpenAI API failed: ${response.status}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content;
  } catch (error) {
    console.error("OpenAI call failed:", error);
    throw error;
  }
}

// --- PIPELINE FUNCTIONS ---

async function runPromptArchitect(userInput) {
  const systemInstruction = `You are a FlutterFlow Integration Architect. Your job is to analyze a user's request and produce a comprehensive, structured JSON specification for a code generator that will create FlutterFlow-compatible Dart code.

You have deep knowledge of FlutterFlow's three custom code silos and their specific constraints:

---

## THE THREE ARTIFACT TYPES

**1. Custom Function** (Logic Silo)
- Purpose: Synchronous data manipulation, math calculations, string formatting, data transformation
- CRITICAL RESTRICTION: NO external imports allowed. Only dart:core, dart:math, dart:convert, dart:collection
- Returns: Synchronous value (String, int, double, bool, List, Map, etc.)
- Use when: Pure computation with no side effects, no async operations, no external dependencies
- Example use cases: Luhn algorithm validation, date formatting, list filtering, math calculations

**2. Custom Action** (Async Silo)
- Purpose: Side effects, API calls, complex logic chains, third-party library usage, file operations
- Return type: ALWAYS Future<T> - even synchronous logic must be wrapped
- External imports: ALLOWED (packages from pub.dev that FlutterFlow supports)
- Use when: Anything async, anything needing external packages, anything with side effects, Bluetooth/sensors
- Example use cases: HTTP requests, data smoothing algorithms with external libs, file I/O, device APIs

**3. Custom Widget** (Visual Silo)
- Purpose: Custom UI not available in FlutterFlow's component library
- CRITICAL: Must accept width and height parameters (both nullable doubles) - FlutterFlow injects these
- Data passed strictly via constructor parameters - no access to parent page state or FFAppState() unless passed
- The widget is a "black box" to FlutterFlow's editor - it renders as placeholder in design view
- Use when: Charts, gauges, custom painters, complex animations, gesture-heavy interactions, canvas drawing
- Example use cases: Radial gauges, custom charts, signature pads, audio visualizers, game elements

---

## FLUTTERFLOW TYPE SYSTEM (Parameters)

Only these parameter types work in FlutterFlow's Custom Code UI:
- Primitives: String, bool, int, double, Color, DateTime
- Lists of primitives: List<String>, List<int>, List<double>, List<bool>
- FlutterFlow Structs: SomeNameStruct or List<SomeNameStruct> (must exist in FF Data Types)
- Special types: DocumentReference, LatLng (only if project uses Firebase/Maps)
- Action callbacks: Future<dynamic> Function()? (Custom Widgets only, for triggering FF actions)

IMPORTANT: Never define new Dart model classes. If structured data is needed, specify the FlutterFlow Struct that should be created in Data Types.

---

## YOUR TASK

Analyze the user's request and output a JSON specification with this exact structure:

{
  "artifactType": "CustomWidget" | "CustomAction" | "CustomFunction",
  "artifactName": "ExactNameInPascalCase",
  "rationale": "Why this artifact type is appropriate for this request",
  
  "parameters": [
    {
      "name": "paramName",
      "ffType": "FlutterFlow UI type (e.g., Double, String, Data Type - GaugeZone)",
      "dartType": "Dart type (e.g., double?, String, List<GaugeZoneStruct>)",
      "required": true | false,
      "defaultHandling": "How null/missing values should be handled"
    }
  ],
  
  "dataTypesRequired": [
    {
      "structName": "NameOfStruct",
      "fields": [
        {"name": "fieldName", "type": "String | int | double | bool | Color | DateTime | List<T>"}
      ],
      "purpose": "What this struct represents"
    }
  ],
  
  "dependencies": {
    "allowed": true | false,
    "packages": ["package_name: ^version"] | [],
    "dartImports": ["dart:math", "dart:convert"] | [],
    "note": "Explanation if dependencies are restricted"
  },
  
  "implementationSpec": {
    "description": "Detailed description of what the code should do",
    "visualRequirements": "For widgets: appearance, colors, layout behavior",
    "behavioralRequirements": "Interactions, animations, state changes",
    "edgeCases": ["List of edge cases to handle"],
    "flutterFlowPatterns": ["Use FlutterFlowTheme.of(context).primary for colors", "other FF-specific patterns"]
  },
  
  "constraints": {
    "artifactSpecific": ["Constraints specific to this artifact type"],
    "nullSafety": ["Null handling requirements"],
    "layoutSafety": ["For widgets: overflow prevention, size handling"]
  },
  
  "antiPatterns": {
    "mustNotInclude": ["main()", "runApp()", "MaterialApp", "Scaffold"],
    "mustNotUse": ["FFAppState() direct access", "hardcoded Colors.*"],
    "reasoning": ["Why each anti-pattern is forbidden in FlutterFlow context"]
  }
}

---

## ARTIFACT-SPECIFIC CONSTRAINT RULES

When artifactType is "CustomFunction":
- dependencies.allowed MUST be false
- dependencies.packages MUST be empty []
- dependencies.note MUST explain "Custom Functions cannot use external packages - pure Dart only"
- antiPatterns.mustNotInclude MUST include any async/await keywords
- No Future return types allowed

When artifactType is "CustomAction":
- Return type MUST be Future<T>
- constraints.artifactSpecific MUST mention "Must use async/await pattern"
- constraints.artifactSpecific MUST mention "Return type is always Future"

When artifactType is "CustomWidget":
- parameters MUST include width (double?, not required) and height (double?, not required) FIRST
- constraints.layoutSafety MUST address null width/height handling
- constraints.layoutSafety MUST mention overflow prevention
- constraints.layoutSafety MUST mention using LayoutBuilder if size-dependent rendering
- implementationSpec.flutterFlowPatterns MUST include FlutterFlowTheme usage
- If stateful, antiPatterns MUST mention proper disposal of controllers

---

Output ONLY the raw JSON object. No markdown code fences, no explanatory text, no preamble. Just valid JSON.`;

  const prompt = `Analyze this FlutterFlow custom code request and produce a JSON specification:

"${userInput}"

Remember: Output ONLY valid JSON matching the specified structure.`;

  try {
    const result = await callGemini(
      prompt,
      systemInstruction,
      PROMPT_ARCHITECT_MODEL
    );
    return result;
  } catch (error) {
    console.error("Prompt Architect failed:", error);
    throw error;
  }
}

async function runCodeGenerator(masterPrompt, selectedModel) {
  let result;

  // Base system instruction with all FlutterFlow constraints
  const baseSystemInstruction = `You are a Senior Flutter/Dart Engineer specializing in FlutterFlow custom code production. You receive a JSON specification and output ONLY production-ready Dart code that compiles immediately when pasted into FlutterFlow.

---

## HARD CONSTRAINTS (NON-NEGOTIABLE)

### A) Strict Null Safety
- 100% null-safe Dart required - no exceptions
- Every nullable input must have explicit defaults or guards
- NEVER use the \`!\` operator unless mathematically proven safe - prefer \`??\` or \`?.\` instead
- Handle null width/height gracefully in Custom Widgets (use LayoutBuilder or sensible defaults)

### B) External Dependencies
- Only use packages explicitly listed in the specification's "dependencies" section
- For Custom Functions: NO external packages whatsoever - this is enforced by FlutterFlow
- All packages must be FlutterFlow-compatible and available on pub.dev
- Allowed Dart SDK imports: dart:math, dart:convert, dart:async, dart:collection, dart:ui

### C) FlutterFlow Boilerplate Mandate
- Do NOT output any import statements - FlutterFlow manages all imports automatically
- Do NOT include comments like "// Automatic FlutterFlow imports" or "// Do not edit above"
- Code will be pasted BELOW FlutterFlow's auto-generated import section
- Class/function name MUST match the "artifactName" from the specification EXACTLY (case-sensitive)

### D) No App Harness Code - CRITICAL
These will cause immediate build failures in FlutterFlow:
- NO void main() or main() function
- NO runApp() call
- NO MaterialApp widget
- NO Scaffold widget (unless the spec explicitly requires a full-screen scaffold, which is rare)
- NO CupertinoApp or WidgetsApp
- NO MyApp or similar wrapper classes

### E) Constructor Parameter Mapping
- Parameter names and types MUST match the specification's parameter table exactly
- For Custom Widgets, ALWAYS include these as the first parameters:
  \`\`\`
  final double? width;
  final double? height;
  \`\`\`
- Handle null width/height - never assume they have values

### F) Widget Structure Rules
- Prefer StatelessWidget when no internal state is needed
- Use StatefulWidget ONLY for: AnimationController, gesture tracking, local transient UI state
- State class naming convention: \`_ArtifactNameState\` (private, with underscore prefix)
- ALWAYS dispose() controllers, AnimationControllers, StreamSubscriptions, TextEditingControllers
- Use \`with SingleTickerProviderStateMixin\` or \`TickerProviderStateMixin\` for animations

### G) FlutterFlow Integration Patterns
- Use FlutterFlow Structs from the spec (e.g., \`GaugeZoneStruct\`) - never create custom Dart classes for data
- Access struct fields with null safety: \`zone.startAngle ?? 0.0\`
- Use \`FlutterFlowTheme.of(context).primary\` instead of \`Colors.blue\` for theme colors
- Use \`FlutterFlowTheme.of(context).primaryText\` for text colors
- Use \`FlutterFlowTheme.of(context).secondaryBackground\` for surface colors
- Action callback signature: \`final Future<dynamic> Function()? onSomeAction;\`
- To invoke callbacks: \`widget.onSomeAction?.call();\`

### H) Layout Safety (Custom Widgets)
- Must render correctly when width and height are null
- Must NOT cause overflow errors - use Flexible, Expanded, or constrained containers
- Use LayoutBuilder when you need reliable size constraints:
  \`\`\`
  LayoutBuilder(
    builder: (context, constraints) {
      final w = widget.width ?? constraints.maxWidth;
      final h = widget.height ?? constraints.maxHeight;
      // Use w and h safely
    }
  )
  \`\`\`
- Clamp values to prevent negative sizes: \`size.clamp(0.0, maxSize)\`
- For CustomPainter, handle edge cases where size is zero

### I) Animation Best Practices
- Initialize AnimationController in initState(), not in build()
- Always set vsync: this (requires TickerProviderStateMixin)
- Use didUpdateWidget() to respond to parameter changes from FlutterFlow
- Prefer Curves.easeInOut or physics-based curves for natural motion
- Duration should be reasonable (150-500ms for UI, up to 1200ms for dramatic effects)

---

## OUTPUT FORMAT

Output ONLY the complete Dart code. Nothing else.
- No markdown code fences (\`\`\`)
- No "Here's the code:" or similar preamble
- No explanatory comments outside the code
- No trailing explanation
- Just raw, valid Dart code that compiles

The code should paste directly into FlutterFlow's custom code editor and compile without modification.`;

  // Model-specific instruction adjustments
  const getModelSpecificInstruction = (baseInstruction, model) => {
    const modelTweaks = {
      "claude-4.5-opus": `
ADDITIONAL GUIDANCE FOR THIS MODEL:
- Be extremely precise with Dart syntax
- Prefer explicit type annotations over inference
- Use comprehensive null checks`,
      
      "gpt-5.2-codex": `
ADDITIONAL GUIDANCE FOR THIS MODEL:  
- Focus on code correctness over verbosity
- Ensure all edge cases from the spec are handled
- Double-check parameter types match exactly`,
      
      "gemini-3.0-pro": `
ADDITIONAL GUIDANCE FOR THIS MODEL:
- Strictly follow the JSON specification structure
- Do not add features not specified in the requirements
- Keep the implementation focused and minimal`
    };

    const tweak = modelTweaks[model] || modelTweaks["gemini-3.0-pro"];
    return baseInstruction + "\n\n---\n" + tweak;
  };

  const systemInstruction = getModelSpecificInstruction(baseSystemInstruction, selectedModel);

  // Format the master prompt to clearly present the JSON spec
  const formattedPrompt = `Generate FlutterFlow-compatible Dart code based on this specification:

${masterPrompt}

Remember: Output ONLY the raw Dart code. No markdown, no explanations.`;

  try {
    switch (selectedModel) {
      case "claude-4.5-opus":
        result = await callClaude(formattedPrompt, systemInstruction);
        break;
      case "gpt-5.2-codex":
        result = await callOpenAI(formattedPrompt, systemInstruction);
        break;
      case "gemini-3.0-pro":
      default:
        result = await callGemini(
          formattedPrompt,
          systemInstruction,
          "gemini-3.0-pro-preview"
        );
        break;
    }
    return result;
  } catch (error) {
    console.error("Code Generator failed:", error);

    // If selected model failed due to API key issues, fallback to Gemini
    if (
      error.message.includes("authentication") ||
      error.message.includes("401")
    ) {
      console.log(
        "Selected model failed due to API key issues, falling back to Gemini 3.0 Pro..."
      );
      try {
        const fallbackInstruction = getModelSpecificInstruction(baseSystemInstruction, "gemini-3.0-pro");
        result = await callGemini(
          formattedPrompt,
          fallbackInstruction,
          "gemini-3.0-pro-preview"
        );
        return result;
      } catch (fallbackError) {
        console.error("Gemini fallback also failed:", fallbackError);
        throw new Error(
          `All models failed. Original error: ${error.message}. Fallback error: ${fallbackError.message}`
        );
      }
    }

    throw error;
  }
}

async function runCodeDissector(code) {
  const systemInstruction = `You are a ruthless Code Auditor specializing in FlutterFlow custom code. Your job is to identify issues that will cause problems when pasting code into FlutterFlow.

Check for these critical issues:

## CRITICAL FAILURES (Code will not compile in FlutterFlow)
1. 'void main()' or 'main()' function presence - INSTANT FAIL
2. 'runApp()' call - INSTANT FAIL  
3. 'MaterialApp' or 'CupertinoApp' widget - INSTANT FAIL
4. 'Scaffold' widget (unless explicitly required) - LIKELY FAIL
5. Import statements (FlutterFlow manages these) - FAIL
6. Custom Dart classes for data models (should use FF Structs) - FAIL

## WARNINGS (May cause runtime issues)
1. External package imports not in FlutterFlow's dependency list
2. Null safety violations (missing null checks, unsafe ! operator usage)
3. Constructor argument mismatches with parameter specification
4. Missing width/height parameters for Custom Widgets
5. Hardcoded colors instead of FlutterFlowTheme.of(context)
6. Direct FFAppState() access without it being passed as parameter
7. Missing dispose() for controllers, streams, subscriptions

## LAYOUT ISSUES (May cause visual problems)
1. No handling for null width/height
2. Potential overflow situations
3. Missing LayoutBuilder for size-dependent rendering

Return a structured audit in markdown format with these sections:

## Overall Score
Give a score from 0-100 with brief explanation

## Critical Issues
List any compilation failures here - these MUST be fixed

## Warnings  
List potential runtime problems here

## Recommendations
Provide specific, actionable fixes here

Be thorough but concise. Focus on FlutterFlow-specific issues.`;

  const prompt = `Audit this Dart code for FlutterFlow integration:\n\n${code}`;

  try {
    const result = await callGemini(
      prompt,
      systemInstruction,
      CODE_DISSECTOR_MODEL
    );
    return result;
  } catch (error) {
    console.error("Code Dissector failed:", error);
    throw error;
  }
}

// --- MARKDOWN RENDERING ---

function renderMarkdownAudit(markdown) {
  // Parse markdown and convert to rich HTML
  let html = `<div class="audit-report space-y-4">`;

  // Split by lines and process
  const lines = markdown.split("\n");
  let currentSection = "";
  let inCodeBlock = false;
  let codeBlockContent = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Handle code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        const language = detectLanguage(codeBlockContent);
        const highlightedCode = highlightCode(
          codeBlockContent.trim(),
          language
        );
        html += `<div class="bg-black/50 rounded-lg p-3 border border-white/10">
          <pre class="text-xs font-mono overflow-x-auto"><code class="language-${language}">${highlightedCode}</code></pre>
        </div>`;
        codeBlockContent = "";
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent += line + "\n";
      continue;
    }

    // Handle headers
    if (line.startsWith("# ")) {
      const title = line.substring(2).trim();
      const icon = getSectionIcon(title);
      html += `<div class="audit-header mb-4">
        <h2 class="text-xl font-bold text-white flex items-center gap-2">
          <span>${icon}</span>
          <span>${title}</span>
        </h2>
      </div>`;
      continue;
    }

    if (line.startsWith("## ")) {
      const title = line.substring(3).trim();
      const icon = getSubsectionIcon(title);
      html += `<div class="audit-subsection mb-3">
        <h3 class="text-lg font-semibold text-white flex items-center gap-2">
          <span>${icon}</span>
          <span>${title}</span>
        </h3>
      </div>`;
      continue;
    }

    // Handle lists
    if (line.match(/^[-*+]\s+/)) {
      const item = line.replace(/^[-*+]\s+/, "").trim();
      html += `<div class="audit-list-item flex items-start gap-2 mb-2">
        <span class="text-indigo-400 mt-1">•</span>
        <span class="text-gray-300 text-sm">${processInlineFormatting(item)}</span>
      </div>`;
      continue;
    }

    // Handle numbered lists
    if (line.match(/^\d+\.\s+/)) {
      const item = line.replace(/^\d+\.\s+/, "").trim();
      html += `<div class="audit-list-item flex items-start gap-2 mb-2">
        <span class="text-indigo-400 mt-1">•</span>
        <span class="text-gray-300 text-sm">${processInlineFormatting(item)}</span>
      </div>`;
      continue;
    }

    // Handle empty lines
    if (line.trim() === "") {
      continue;
    }

    // Handle regular paragraphs
    html += `<p class="text-gray-300 text-sm mb-2">${processInlineFormatting(line)}</p>`;
  }

  html += `</div>`;

  // Wrap in styled container
  return `
    <div class="bg-gradient-to-br from-slate-900/50 to-indigo-900/20 border border-white/10 rounded-xl p-6 backdrop-blur-sm">
      <div class="flex items-center gap-2 mb-4">
        <div class="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
        <span class="text-xs font-bold text-green-400 uppercase tracking-wider">Live Audit Report</span>
      </div>
      ${html}
    </div>
  `;
}

function getSectionIcon(title) {
  const icons = {
    "Integration Audit Report": "📋",
    "Critical Issues": "❌",
    Warnings: "⚠️",
    Recommendations: "✅",
    "Overall Score": "📊",
  };

  for (const [key, icon] of Object.entries(icons)) {
    if (title.toLowerCase().includes(key.toLowerCase())) {
      return icon;
    }
  }
  return "📄";
}

function getSubsectionIcon(title) {
  const icons = {
    critical: "❌",
    warning: "⚠️",
    recommendation: "✅",
    score: "📊",
    issue: "🔍",
    fix: "🔧",
  };

  for (const [key, icon] of Object.entries(icons)) {
    if (title.toLowerCase().includes(key.toLowerCase())) {
      return icon;
    }
  }
  return "📝";
}

function detectLanguage(code) {
  // Simple language detection based on code content
  if (
    (code.includes("class ") && code.includes("extends ")) ||
    code.includes("StatelessWidget") ||
    code.includes("StatefulWidget") ||
    code.includes("import 'package:flutter/")
  ) {
    return "dart";
  }
  if (
    code.includes("def ") ||
    code.includes("import ") ||
    code.includes("print(")
  ) {
    return "python";
  }
  if (
    code.includes("function ") ||
    code.includes("const ") ||
    code.includes("console.")
  ) {
    return "javascript";
  }
  return "dart"; // Default to dart for this use case
}

function processInlineFormatting(text) {
  // Bold text **text**
  text = text.replace(
    /\*\*(.*?)\*\*/g,
    '<strong class="text-white font-semibold">$1</strong>'
  );

  // Italic text *text*
  text = text.replace(/\*(.*?)\*/g, '<em class="text-indigo-300">$1</em>');

  // Inline code `code`
  text = text.replace(/`(.*?)`/g, (match, code) => {
    const highlightedCode = highlightCode(code, "dart");
    return `<code class="bg-black/30 text-indigo-300 px-1 py-0.5 rounded text-xs font-mono">${highlightedCode}</code>`;
  });

  // Highlight important terms
  text = text.replace(
    /\b(FAIL|ERROR|CRITICAL)\b/g,
    '<span class="text-red-400 font-bold">$1</span>'
  );
  text = text.replace(
    /\b(WARN|WARNING)\b/g,
    '<span class="text-yellow-400 font-bold">$1</span>'
  );
  text = text.replace(
    /\b(PASS|SUCCESS|OK)\b/g,
    '<span class="text-green-400 font-bold">$1</span>'
  );

  return text;
}

// --- UI FUNCTIONS ---

function updateStepIndicator(step, status) {
  const indicator = document.getElementById(`step${step}-indicator`);
  if (!indicator) return;

  indicator.className = "step-badge";

  if (status === "active") {
    indicator.classList.add("active");
    indicator.innerHTML = step;
  } else if (status === "completed") {
    indicator.classList.add("done");
    indicator.innerHTML = "&#10003;";
  } else if (status === "error") {
    indicator.classList.add("error");
    indicator.innerHTML = "&#10005;";
  } else {
    indicator.innerHTML = step;
  }
}

function showStepLoading(step, show) {
  const loading = document.getElementById(`step${step}-loading`);
  const result = document.getElementById(`step${step}-result`);

  if (show) {
    loading.classList.remove("hidden");
    result.classList.add("hidden");
    updateStepIndicator(step, "active");
  } else {
    loading.classList.add("hidden");
    result.classList.remove("hidden");
    updateStepIndicator(step, "completed");
  }
}

function toggleStep(step) {
  const content = document.getElementById(`${step}-content`);
  const chevron = document.getElementById(`${step}-chevron`);

  if (content.classList.contains("open")) {
    content.classList.remove("open");
    if (chevron) chevron.style.transform = "rotate(0deg)";
  } else {
    content.classList.add("open");
    if (chevron) chevron.style.transform = "rotate(180deg)";
  }
}

function copyCode(elementId) {
  const element = document.getElementById(elementId);
  if (!element) return;

  // Use stored raw code if available, otherwise use textContent
  const text = element.dataset.raw || element.textContent;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      // Find the copy button for this element
      const container = element.closest(".code-container");
      const btn = container?.querySelector(".copy-btn");
      if (btn) {
        btn.classList.add("copied");
        btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Copied!`;
        setTimeout(() => {
          btn.classList.remove("copied");
          btn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg> Copy`;
        }, 2000);
      }
    })
    .catch((err) => {
      console.warn("Failed to copy to clipboard:", err);
    });
}

function updateModelInfo(selectedModel) {
  const modelInfo = document.getElementById("step2-model-info");
  const modelNames = {
    "gemini-3.0-pro": "Gemini 3.0 Pro",
    "claude-4.5-opus": "Claude 4.5 Opus",
    "gpt-5.2-codex": "GPT-5.2-Codex",
  };

  modelInfo.textContent = `Using ${modelNames[selectedModel]}`;
}

// --- MAIN PIPELINE ---

async function runThinkingPipeline() {
  console.log("runThinkingPipeline called");
  if (pipelineState.isRunning) return;

  const userInput = document.getElementById("pipeline-input").value;
  const selectedModel = document.getElementById("code-generator-model").value;

  if (!userInput.trim()) {
    alert("Please describe your FlutterFlow widget first.");
    return;
  }

  // Check for image references in non-Gemini models
  if (
    selectedModel !== "gemini-3.0-pro" &&
    (userInput.toLowerCase().includes("screenshot") ||
      userInput.toLowerCase().includes("image") ||
      userInput.toLowerCase().includes("picture"))
  ) {
    const proceed = confirm(
      "⚠️ Your request mentions images.\n\n" +
        `${selectedModel} doesn't support image input.\n\n` +
        "Use Gemini 3.0 Pro for image-based requests,\n" +
        "or remove image references and continue.\n\n" +
        "Continue anyway?"
    );
    if (!proceed) return;
  }

  const btn = document.getElementById("btn-run-pipeline");

  // Reset state
  pipelineState.isRunning = true;
  pipelineState.step1Result = null;
  pipelineState.step2Result = null;
  pipelineState.step3Result = null;

  btn.disabled = true;
  btn.textContent = "Running...";

  // Update model info
  updateModelInfo(selectedModel);

  try {
    // Step 1: Prompt Architect
    showStepLoading(1, true);
    toggleStep("step1");

    pipelineState.step1Result = await runPromptArchitect(userInput);

    const step1Output = document.getElementById("step1-output");
    const cleanStep1 = extractCodeFromMarkdown(pipelineState.step1Result);
    step1Output.innerHTML = highlightCode(cleanStep1);
    step1Output.dataset.raw = cleanStep1; // Store raw for copy
    showStepLoading(1, false);

    // Step 2: Code Generator
    showStepLoading(2, true);
    toggleStep("step2");

    pipelineState.step2Result = await runCodeGenerator(
      pipelineState.step1Result,
      selectedModel
    );

    const step2Output = document.getElementById("step2-output");
    const cleanStep2 = extractCodeFromMarkdown(pipelineState.step2Result);
    step2Output.innerHTML = highlightCode(cleanStep2);
    step2Output.dataset.raw = cleanStep2; // Store raw for copy
    showStepLoading(2, false);

    // Step 3: Code Audit
    showStepLoading(3, true);
    toggleStep("step3");

    pipelineState.step3Result = await runCodeDissector(
      pipelineState.step2Result
    );

    const auditOutput = document.getElementById("step3-output");
    auditOutput.innerHTML = renderMarkdownAudit(pipelineState.step3Result);

    showStepLoading(3, false);
  } catch (error) {
    console.error("Pipeline failed:", error);

    // Determine which step failed based on the error context
    let errorStep = 1; // Default to step 1
    if (
      error.message.includes("Claude") ||
      error.message.includes("OpenAI") ||
      error.message.includes("Code Generator")
    ) {
      errorStep = 2;
    } else if (error.message.includes("Code Dissector")) {
      errorStep = 3;
    }

    const resultDiv = document.getElementById(`step${errorStep}-result`);
    const loadingDiv = document.getElementById(`step${errorStep}-loading`);
    const output = document.getElementById(`step${errorStep}-output`);
    const contentDiv = document.getElementById(`step${errorStep}-content`);

    // Hide loading and show error, but keep content open
    if (loadingDiv) loadingDiv.classList.add("hidden");
    if (resultDiv) resultDiv.classList.remove("hidden");
    if (contentDiv && !contentDiv.classList.contains("open")) {
      contentDiv.classList.add("open");
    }

    if (output) {
      // Format error message based on type
      let errorMessage = error.message;
      if (error.message.includes("image input")) {
        errorMessage =
          "This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests or remove image references from your prompt.";
      } else if (
        error.message.includes("Load failed") ||
        error.message.includes("CORS")
      ) {
        errorMessage =
          "API connection failed. This might be due to CORS restrictions or network issues. Please check your API key and try again.";
      }

      output.innerHTML = `<div class="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
        <h4 class="text-red-400 font-bold text-xs uppercase mb-2">Connection Error</h4>
        <p class="text-sm text-red-300">${errorMessage}</p>
        <div class="mt-3 text-xs text-gray-400">
          <p>• Check if API key is valid</p>
          <p>• Try using a different model</p>
          <p>• Ensure network allows API calls</p>
        </div>
      </div>`;
    }

    updateStepIndicator(errorStep, "error");
  } finally {
    pipelineState.isRunning = false;
    btn.disabled = false;
    btn.textContent = "Generate";
  }
}

function retryWithDifferentModel() {
  // Show model selection dialog
  const currentModel = document.getElementById("code-generator-model").value;
  const otherModels = [
    "gemini-3.0-pro",
    "claude-4.5-opus",
    "gpt-5.2-codex",
  ].filter((model) => model !== currentModel);

  const selectedModel = prompt(
    `Retry with different model?\n\nCurrent: ${currentModel}\n\nOptions:\n1. ${otherModels[0]}\n2. ${otherModels[1]}\n\nEnter 1 or 2:`
  );

  if (selectedModel === "1") {
    document.getElementById("code-generator-model").value = otherModels[0];
    runThinkingPipeline();
  } else if (selectedModel === "2") {
    document.getElementById("code-generator-model").value = otherModels[1];
    runThinkingPipeline();
  }
}

// --- SYNTAX HIGHLIGHTING ---

// Extract code from markdown code blocks (strips ```dart ... ```)
function extractCodeFromMarkdown(text) {
  if (!text) return text;

  // Match ```language\n...code...\n``` pattern
  const codeBlockRegex = /```(?:\w+)?\n?([\s\S]*?)```/;
  const match = text.match(codeBlockRegex);

  if (match) {
    return match[1].trim();
  }

  // If no code block found, return original text trimmed
  return text.trim();
}

function highlightCode(code, language = "dart") {
  try {
    // Strip markdown code fences before highlighting
    const cleanCode = extractCodeFromMarkdown(code);
    return hljs.highlight(cleanCode, { language: language }).value;
  } catch (error) {
    console.warn("Syntax highlighting failed:", error);
    return extractCodeFromMarkdown(code);
  }
}

// --- INITIALIZATION ---

document.addEventListener("DOMContentLoaded", () => {
  // Initialize highlight.js
  hljs.configure({
    tabReplace: "  ",
    classPrefix: "hljs-",
  });

  checkConnection();
});

// Global exports
window.runThinkingPipeline = runThinkingPipeline;
window.toggleStep = toggleStep;
window.copyCode = copyCode;
window.retryWithDifferentModel = retryWithDifferentModel;
