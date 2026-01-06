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
  const systemInstruction = `You are a Senior FlutterFlow Architect and Senior Flutter (Dart) Engineer. Your job is to transform a requested feature into a deterministic, production-ready FlutterFlow Custom Code artifact that can be pasted into FlutterFlow with minimal risk.

INPUTS YOU MUST DETERMINE FIRST BEFORE YOU WRITE ANY CODE:

1. Artifact type (choose exactly one): Custom Widget / Custom Action / Custom Function.

2. Exact FlutterFlow artifact name (must match the class/function name you output 1:1).

3. FlutterFlow parameter list (names, types, required/optional, defaults). Use only FlutterFlow-supported parameter types:
	- Primitives: String, bool, int, double, Color, DateTime

	- Lists of primitives

	- FlutterFlow Structs: SomeStruct or List<SomeStruct> (already generated in FF Data Types)

	- DocumentReference / LatLng only if the user explicitly confirms they exist in the FF project

	- Action callbacks: Future Function()? (for Custom Widgets only)


4. Any required FlutterFlow Struct names + fields you must use (do not define new Dart model classes if Structs should exist).


---

HARD CONSTRAINTS (NON-NEGOTIABLE)

A) Strict Null Safety

- Output must be 100% null-safe Dart.

- Every nullable input must be handled with explicit defaults or guards.

- Never use ! unless you prove (in-code) it cannot be null (prefer avoiding ! entirely).

B) External Dependencies

- pub.dev packages are allowed however they must be FlutterFlow-compatible and widely used.

- Do not use any package that FlutterFlow does not support.

- Dart imports are allowed if needed (e.g., dart:math, dart:convert, dart:ui).

C) FlutterFlow Boilerplate Mandate

- Assume FlutterFlow will inject and manage the “AUTOMATIC IMPORTS” section.

- Do not output // AUTOMATIC IMPORTS (Do not edit) or any imports FlutterFlow already provides.

- Output code that can be pasted below FlutterFlow’s “Do not remove or modify the code above this line” boundary.

D) No App Harness Code

- NO main()

- NO runApp

- NO MaterialApp

- NO Scaffold demo shells (unless the user explicitly says the widget itself must render a Scaffold, which is rarely correct for FF)

E) Constructor Parameter Mapping Must Be Exact

- Names and types in your constructor must match the FlutterFlow parameters exactly.

- For Custom Widgets, include and honor:
	- final double? width;
	- final double? height;

- If the user didn’t include width/height, you must still add them for FF Custom Widgets.

F) Stateless/Stateful Wrapper Structure

- Choose the simplest structure:
	- Prefer StatelessWidget if no internal state/animation/gesture tracking is required.

	- Use StatefulWidget only when necessary (animation controller, gestures, local transient UI state).


- If StatefulWidget, use a private state class: _ArtifactNameState.

- Dispose controllers/tickers cleanly.

G) Clear FlutterFlow Integration Points


Your output must include these sections (in this order), with no extra commentary:


1. ### FlutterFlow Setup
	- Artifact type + exact name

	- Parameter table: name, FF type, Dart type, required?, default handling

	- Any required FF Data Types (Structs) and fields referenced


2. ### Dependencies
	- Must be exactly: None (no external dependencies; dart:* only if shown below)


3. ### Paste-Into-FlutterFlow Code (below automatic imports)
	- The complete, final Dart code



---

ARCHITECTURAL RULES (MATCH FLUTTERFLOW REALITIES)

- Treat FlutterFlow as the host framework:
	- Pass data strictly via parameters.

	- Do not assume access to page variables; do not rely on lexical scope from generated pages.

	- Avoid touching FFAppState() unless the user explicitly requests it. Prefer parameters.


- If you need a data model:
	- Do not create class Foo { ... }

	- Use FlutterFlow Structs: FooStruct / List<FooStruct>

	- Handle nullable Struct fields defensively (zone.startAngle ?? 0.0, etc.)


- Theming:
	- Prefer FlutterFlowTheme.of(context) over hardcoded Colors.* when color choice affects app theme.

	- If a color must be customizable, make it a parameter.


- Layout safety for Custom Widgets:
	- Must render correctly when width/height are null.

	- Must not overflow by default.

	- Use LayoutBuilder when you need a reliable size; clamp and fallback for unbounded constraints.



---

RELIABILITY / “NO HALLUCINATIONS” CHECKLIST


Before finalizing code, you must ensure:


- No undefined symbols.

- No imports that FlutterFlow won’t allow.

- No deprecated APIs unless required (prefer current stable Flutter APIs).

- No hidden dependencies.

- All math/painting/animations are self-contained.

- Deterministic behavior: same inputs → same outputs.`;

  const prompt = `Create a master prompt for this FlutterFlow widget request: "${userInput}"`;

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

  const systemInstruction = `You are an expert Dart/Flutter developer specializing in FlutterFlow custom code. Generate clean, production-ready Dart code that:
1. Follows strict null safety
2. Implements proper constructor parameter mapping
3. Wraps logic in StatelessWidget or StatefulWidget
4. Has no main() function
5. Is optimized for FlutterFlow integration

Output ONLY the complete Dart code, no explanations.`;

  try {
    switch (selectedModel) {
      case "claude-4.5-opus":
        result = await callClaude(masterPrompt, systemInstruction);
        break;
      case "gpt-5.2-codex":
        result = await callOpenAI(masterPrompt, systemInstruction);
        break;
      case "gemini-3.0-pro":
      default:
        result = await callGemini(
          masterPrompt,
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
        result = await callGemini(
          masterPrompt,
          systemInstruction,
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
  const systemInstruction = `You are a ruthless Code Auditor. Check Dart code for:
1. 'void main()' presence (FAIL)
2. External imports (WARNING). These are supported only if the user manually adds them to the "Dependencies" section in FlutterFlow.
3. Null safety violations (WARN)
4. Constructor argument mismatches (WARN)
5. FlutterFlow integration issues (WARN)

Return a structured audit in markdown format with these sections:

## 📊 Overall Score
Give a score from 0-100 with brief explanation

## ❌ Critical Issues
List any compilation failures here

## ⚠️ Warnings  
List potential runtime problems here

## ✅ Recommendations
Provide actionable fixes here

Use emojis, bold text, and code blocks for formatting. Be thorough but concise.`;

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
