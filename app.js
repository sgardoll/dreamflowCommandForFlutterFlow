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
  isRunning: false
};

// --- CORE API FUNCTIONS ---

async function checkConnection() {
  const statusText = document.getElementById("model-status-text");
  const statusLight = document.getElementById("model-status-light");

  if (!geminiApiKey) {
    statusText.innerText = "NO GEMINI API KEY";
    statusLight.className = "status-dot offline";
    console.error("Gemini API Key not found. Check .env file for VITE_GEMINI_API_KEY");
    return false;
  }

  statusText.innerText = `READY: ${PROMPT_ARCHITECT_MODEL}`;
  statusLight.className = "status-dot online";
  return true;
}

async function callGemini(prompt, systemInstruction, modelId = PROMPT_ARCHITECT_MODEL) {
  // Use proxy to avoid CORS issues
  const url = `/api/gemini/v1beta/models/${modelId}:generateContent?key=${geminiApiKey}`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
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
    model: "claude-4-5-opus-2024-10-22",
    max_tokens: 4000,
    system: systemInstruction,
    messages: [{ role: "user", content: prompt }]
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude API Error:", response.status, errorText);
      
      // Handle specific error types
      if (errorText.includes("image") || errorText.includes("media")) {
        throw new Error("Claude API error: This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests.");
      }
      
      if (response.status === 401) {
        throw new Error("Claude API authentication failed. Please check your Anthropic API key in the .env file.");
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
      { role: "user", content: prompt }
    ],
    max_tokens: 4000,
    temperature: 0.1
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${openaiApiKey}`
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("OpenAI API Error:", response.status, errorText);
      
      // Handle specific error types
      if (errorText.includes("image") || errorText.includes("vision") || errorText.includes("media")) {
        throw new Error("OpenAI API error: This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests.");
      }
      
      if (response.status === 401) {
        throw new Error("OpenAI API authentication failed. Please check your OpenAI API key in the .env file.");
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
  const systemInstruction = `You are a Senior FlutterFlow Architect. Analyze the user request and create a 'Master Prompt' that includes:
1. Strict null safety requirements
2. No external dependencies
3. Constructor parameter mapping
4. Stateless/Stateful wrapper structure
5. No main() function
6. Clear FlutterFlow integration points

Output ONLY the optimized prompt, no explanations.`;

  const prompt = `Create a master prompt for this FlutterFlow widget request: "${userInput}"`;
  
  try {
    const result = await callGemini(prompt, systemInstruction, PROMPT_ARCHITECT_MODEL);
    return result;
  } catch (error) {
    console.error("Prompt Architect failed:", error);
    throw error;
  }
}

async function runCodeGenerator(masterPrompt, selectedModel) {
  let result;
  
  const systemInstruction = `You are an expert Dart/Flutter developer specializing in FlutterFlow custom widgets.
Generate clean, production-ready Dart code that:
1. Follows strict null safety
2. Uses no external dependencies
3. Implements proper constructor parameter mapping
4. Wraps logic in StatelessWidget or StatefulWidget
5. Has no main() function
6. Is optimized for FlutterFlow integration

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
        result = await callGemini(masterPrompt, systemInstruction, "gemini-3.0-pro-preview");
        break;
    }
    return result;
  } catch (error) {
    console.error("Code Generator failed:", error);
    
    // If selected model failed due to API key issues, fallback to Gemini
    if (error.message.includes("authentication") || error.message.includes("401")) {
      console.log("Selected model failed due to API key issues, falling back to Gemini 3.0 Pro...");
      try {
        result = await callGemini(masterPrompt, systemInstruction, "gemini-3.0-pro-preview");
        return result;
      } catch (fallbackError) {
        console.error("Gemini fallback also failed:", fallbackError);
        throw new Error(`All models failed. Original error: ${error.message}. Fallback error: ${fallbackError.message}`);
      }
    }
    
    throw error;
  }
}

async function runCodeDissector(code) {
  const systemInstruction = `You are a ruthless Code Auditor. Check Dart code for:
1. 'void main()' presence (FAIL)
2. External imports (FAIL)
3. Null safety violations (WARN)
4. Constructor argument mismatches (WARN)
5. FlutterFlow integration issues (WARN)

Return a structured audit in markdown format with these sections:
# 📋 Integration Audit Report

## ❌ Critical Issues
List any compilation failures here

## ⚠️ Warnings  
List potential runtime problems here

## ✅ Recommendations
Provide actionable fixes here

## 📊 Overall Score
Give a score from 0-100 with brief explanation

Use emojis, bold text, and code blocks for formatting. Be thorough but concise.`;

  const prompt = `Audit this Dart code for FlutterFlow integration:\n\n${code}`;
  
  try {
    const result = await callGemini(prompt, systemInstruction, CODE_DISSECTOR_MODEL);
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
  const lines = markdown.split('\n');
  let currentSection = '';
  let inCodeBlock = false;
  let codeBlockContent = '';
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Handle code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        const language = detectLanguage(codeBlockContent);
        const highlightedCode = highlightCode(codeBlockContent.trim(), language);
        html += `<div class="bg-black/50 rounded-lg p-3 border border-white/10">
          <pre class="text-xs font-mono overflow-x-auto"><code class="language-${language}">${highlightedCode}</code></pre>
        </div>`;
        codeBlockContent = '';
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    
    if (inCodeBlock) {
      codeBlockContent += line + '\n';
      continue;
    }
    
    // Handle headers
    if (line.startsWith('# ')) {
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
    
    if (line.startsWith('## ')) {
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
      const item = line.replace(/^[-*+]\s+/, '').trim();
      html += `<div class="audit-list-item flex items-start gap-2 mb-2">
        <span class="text-indigo-400 mt-1">•</span>
        <span class="text-gray-300 text-sm">${processInlineFormatting(item)}</span>
      </div>`;
      continue;
    }
    
    // Handle numbered lists
    if (line.match(/^\d+\.\s+/)) {
      const item = line.replace(/^\d+\.\s+/, '').trim();
      html += `<div class="audit-list-item flex items-start gap-2 mb-2">
        <span class="text-indigo-400 mt-1">•</span>
        <span class="text-gray-300 text-sm">${processInlineFormatting(item)}</span>
      </div>`;
      continue;
    }
    
    // Handle empty lines
    if (line.trim() === '') {
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
    'Integration Audit Report': '📋',
    'Critical Issues': '❌',
    'Warnings': '⚠️',
    'Recommendations': '✅',
    'Overall Score': '📊'
  };
  
  for (const [key, icon] of Object.entries(icons)) {
    if (title.toLowerCase().includes(key.toLowerCase())) {
      return icon;
    }
  }
  return '📄';
}

function getSubsectionIcon(title) {
  const icons = {
    'critical': '❌',
    'warning': '⚠️',
    'recommendation': '✅',
    'score': '📊',
    'issue': '🔍',
    'fix': '🔧'
  };
  
  for (const [key, icon] of Object.entries(icons)) {
    if (title.toLowerCase().includes(key.toLowerCase())) {
      return icon;
    }
  }
  return '📝';
}

function detectLanguage(code) {
  // Simple language detection based on code content
  if (code.includes('class ') && code.includes('extends ') || 
      code.includes('StatelessWidget') || code.includes('StatefulWidget') ||
      code.includes('import \'package:flutter/')) {
    return 'dart';
  }
  if (code.includes('def ') || code.includes('import ') || code.includes('print(')) {
    return 'python';
  }
  if (code.includes('function ') || code.includes('const ') || code.includes('console.')) {
    return 'javascript';
  }
  return 'dart'; // Default to dart for this use case
}

function processInlineFormatting(text) {
  // Bold text **text**
  text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>');
  
  // Italic text *text*
  text = text.replace(/\*(.*?)\*/g, '<em class="text-indigo-300">$1</em>');
  
  // Inline code `code`
  text = text.replace(/`(.*?)`/g, (match, code) => {
    const highlightedCode = highlightCode(code, 'dart');
    return `<code class="bg-black/30 text-indigo-300 px-1 py-0.5 rounded text-xs font-mono">${highlightedCode}</code>`;
  });
  
  // Highlight important terms
  text = text.replace(/\b(FAIL|ERROR|CRITICAL)\b/g, '<span class="text-red-400 font-bold">$1</span>');
  text = text.replace(/\b(WARN|WARNING)\b/g, '<span class="text-yellow-400 font-bold">$1</span>');
  text = text.replace(/\b(PASS|SUCCESS|OK)\b/g, '<span class="text-green-400 font-bold">$1</span>');
  
  return text;
}

// --- UI FUNCTIONS ---

function updateStepIndicator(step, status) {
  const indicator = document.getElementById(`step${step}-indicator`);
  indicator.className = "step-indicator w-8 h-8 rounded-full text-xs font-bold flex items-center justify-center";
  
  if (status === "active") {
    indicator.classList.add("active");
    indicator.innerHTML = step;
  } else if (status === "completed") {
    indicator.classList.add("completed");
    indicator.innerHTML = "✓";
  } else if (status === "error") {
    indicator.classList.add("bg-red-600");
    indicator.innerHTML = "✕";
  } else {
    indicator.classList.add("bg-gray-700");
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
  const toggle = document.getElementById(`${step}-toggle`);
  
  if (content.classList.contains("expanded")) {
    content.classList.remove("expanded");
    toggle.style.transform = "rotate(0deg)";
  } else {
    content.classList.add("expanded");
    toggle.style.transform = "rotate(180deg)";
  }
}

function updateModelInfo(selectedModel) {
  const modelInfo = document.getElementById("step2-model-info");
  const modelNames = {
    "gemini-3.0-pro": "Gemini 3.0 Pro",
    "claude-4.5-opus": "Claude 4.5 Opus",
    "gpt-5.2-codex": "GPT-5.2-Codex"
  };
  
  modelInfo.textContent = `Model: ${modelNames[selectedModel]} • Dart Code Generation`;
}

// --- MAIN PIPELINE ---

async function runThinkingPipeline() {
  console.log('runThinkingPipeline called');
  if (pipelineState.isRunning) return;
  
  const userInput = document.getElementById("pipeline-input").value;
  const selectedModel = document.getElementById("code-generator-model").value;
  
  if (!userInput.trim()) {
    alert("Please describe your FlutterFlow widget first.");
    return;
  }
  
  // Check for image references in non-Gemini models
  if (selectedModel !== "gemini-3.0-pro" && 
      (userInput.toLowerCase().includes("screenshot") || 
       userInput.toLowerCase().includes("image") || 
       userInput.toLowerCase().includes("picture"))) {
    const proceed = confirm("⚠️ Your request mentions images.\n\n" +
      `${selectedModel} doesn't support image input.\n\n` +
      "Use Gemini 3.0 Pro for image-based requests,\n" +
      "or remove image references and continue.\n\n" +
      "Continue anyway?");
    if (!proceed) return;
  }

  const btn = document.getElementById("btn-run-pipeline");
  const btnText = document.getElementById("pipeline-btn-text");
  
  // Reset state
  pipelineState.isRunning = true;
  pipelineState.step1Result = null;
  pipelineState.step2Result = null;
  pipelineState.step3Result = null;
  
  btn.disabled = true;
  btnText.textContent = "Running Pipeline...";
  
  // Update model info
  updateModelInfo(selectedModel);
  
  try {
    // Step 1: Prompt Architect
    showStepLoading(1, true);
    toggleStep("step1");
    
    pipelineState.step1Result = await runPromptArchitect(userInput);
    
    document.getElementById("step1-output").innerHTML = `<pre><code class="language-dart">${highlightCode(pipelineState.step1Result)}</code></pre>`;
    showStepLoading(1, false);
    
    // Step 2: Code Generator
    showStepLoading(2, true);
    toggleStep("step2");
    
    pipelineState.step2Result = await runCodeGenerator(pipelineState.step1Result, selectedModel);
    
    document.getElementById("step2-output").innerHTML = `<pre><code class="language-dart">${highlightCode(pipelineState.step2Result)}</code></pre>`;
    showStepLoading(2, false);
    
    // Step 3: Code Dissector
    showStepLoading(3, true);
    toggleStep("step3");
    
    pipelineState.step3Result = await runCodeDissector(pipelineState.step2Result);
    
    // Format audit results with rich markdown rendering
    const auditOutput = document.getElementById("step3-output");
    auditOutput.innerHTML = renderMarkdownAudit(pipelineState.step3Result);
    
    showStepLoading(3, false);
    
    // Show retry option if there were issues
    if (pipelineState.step3Result.toLowerCase().includes("fail") || 
        pipelineState.step3Result.toLowerCase().includes("error")) {
      document.getElementById("step2-retry").classList.remove("hidden");
    }
    
  } catch (error) {
    console.error("Pipeline failed:", error);
    
    // Determine which step failed based on the error context
    let errorStep = 1; // Default to step 1
    if (error.message.includes("Claude") || error.message.includes("OpenAI") || 
        error.message.includes("Code Generator")) {
      errorStep = 2;
    } else if (error.message.includes("Code Dissector")) {
      errorStep = 3;
    }
    
    const resultDiv = document.getElementById(`step${errorStep}-result`);
    const loadingDiv = document.getElementById(`step${errorStep}-loading`);
    const output = document.getElementById(`step${errorStep}-output`);
    const contentDiv = document.getElementById(`step${errorStep}-content`);
    
    // Hide loading and show error, but keep content expanded
    if (loadingDiv) loadingDiv.classList.add("hidden");
    if (resultDiv) resultDiv.classList.remove("hidden");
    if (contentDiv && !contentDiv.classList.contains("expanded")) {
      contentDiv.classList.add("expanded");
    }
    
    if (output) {
      // Format error message based on type
      let errorMessage = error.message;
      if (error.message.includes("image input")) {
        errorMessage = "This model doesn't support image input. Please use Gemini 3.0 Pro for image-based requests or remove image references from your prompt.";
      } else if (error.message.includes("Load failed") || error.message.includes("CORS")) {
        errorMessage = "API connection failed. This might be due to CORS restrictions or network issues. Please check your API key and try again.";
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
    
    // Show retry option for code generation failures
    if (errorStep === 2) {
      document.getElementById("step2-retry").classList.remove("hidden");
      updateStepIndicator(errorStep, "error");
    }
    
  } finally {
    pipelineState.isRunning = false;
    btn.disabled = false;
    btnText.textContent = "Run Pipeline";
  }
}

function retryWithDifferentModel() {
  // Show model selection dialog
  const currentModel = document.getElementById("code-generator-model").value;
  const otherModels = ["gemini-3.0-pro", "claude-4.5-opus", "gpt-5.2-codex"]
    .filter(model => model !== currentModel);
  
  const selectedModel = prompt(`Retry with different model?\n\nCurrent: ${currentModel}\n\nOptions:\n1. ${otherModels[0]}\n2. ${otherModels[1]}\n\nEnter 1 or 2:`);
  
  if (selectedModel === "1") {
    document.getElementById("code-generator-model").value = otherModels[0];
    runThinkingPipeline();
  } else if (selectedModel === "2") {
    document.getElementById("code-generator-model").value = otherModels[1];
    runThinkingPipeline();
  }
}

// --- SYNTAX HIGHLIGHTING ---

function highlightCode(code, language = 'dart') {
  try {
    return hljs.highlight(code, { language: language }).value;
  } catch (error) {
    console.warn('Syntax highlighting failed:', error);
    return code;
  }
}

// --- INITIALIZATION ---

document.addEventListener("DOMContentLoaded", () => {
  console.log('DOM loaded, initializing...');
  
  // Test button connection
  const testBtn = document.getElementById("btn-run-pipeline");
  console.log('Button found:', testBtn);
  
  // Initialize highlight.js
  hljs.configure({
    tabReplace: '  ',
    classPrefix: 'hljs-'
  });
  
  checkConnection();
  console.log('Initialization complete');
  
  // Auto-expand first step when results are ready
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.type === "attributes" && 
          mutation.attributeName === "class" &&
          mutation.target.classList.contains("hidden") === false) {
        // Step result is now visible, auto-expand
        const stepId = mutation.target.id.replace("-result", "");
        if (stepId.startsWith("step")) {
          setTimeout(() => toggleStep(stepId), 100);
        }
      }
    });
  });
  
  // Observe all result containers
  for (let i = 1; i <= 3; i++) {
    const resultDiv = document.getElementById(`step${i}-result`);
    if (resultDiv) {
      observer.observe(resultDiv, { attributes: true });
    }
  }
});

// Global exports
window.runThinkingPipeline = runThinkingPipeline;
window.toggleStep = toggleStep;
window.retryWithDifferentModel = retryWithDifferentModel;