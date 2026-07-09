import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Verify Env Keys
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENROUTER_API_KEY) {
  console.error("❌ Missing environment variables in .env file.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL_NAME = process.env.OPENROUTER_MODEL || "google/gemma-4-26b-a4b-it";
const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dimensions

// Helper to delay requests (prevents API rate limits)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Token counters
let gemmaInputTokens = 0;
let gemmaOutputTokens = 0;
let embeddingTokens = 0;
let totalClausesExtracted = 0;

// Call OpenRouter to parse OSH text + image into structured JSON clauses
async function parsePageMultimodal(pageText, pageImageBase64, pageNum) {
  const systemPrompt = `You are an expert Occupational Safety and Health (OSH) legal and technical machinery inspector. 
Your task is to analyze the provided page text and the accompanying diagram/image from the DOSH Guidelines on Safe Use of Press Machines.

Identify all safety obligations, safety guard designs, electrical safety setups, distances, or operational procedures discussed on this page.

For each requirement identified, extract:
1. "section_number": e.g., "Section 5.1" or "Figure 3 details" (reference the page or figure if possible).
2. "clause_text": The description of the rule or what the diagram/drawing demonstrates.
3. "required_action": An actionable, plain-language checklist instruction of what the employer must do to comply.
4. "trigger_activity": The worker/operational activity that triggers this law (e.g., "press machine operation", "press machine guarding"). Keep this keyword-focused and lowercase.
5. "frequency": e.g. "continuous", "daily", "once", "weekly".

Your response MUST be a valid JSON array of objects. Do not include any markdown comments, backticks, or text before or after the JSON.
Example output format:
[
  {
    "section_number": "Section 4.1",
    "clause_text": "An interlocked guard must be fitted to prevent access to the press slide...",
    "trigger_activity": "press machine guarding",
    "required_action": "Fit an interlocked safety guard on the press slide area.",
    "frequency": "continuous"
  }
]`;

  const requestContent = [
    {
      type: "text",
      text: `Page ${pageNum} Text:\n\n${pageText}\n\nAnalyze this page and its diagram to extract OSH guidelines.`
    }
  ];

  if (pageImageBase64) {
    requestContent.push({
      type: "image_url",
      image_url: {
        url: pageImageBase64
      }
    });
  }

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://amerispro.com",
          "X-Title": "AmerisPro Multimodal Token Test"
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: requestContent }
          ],
          temperature: 0.1,
          max_tokens: 2048
        })
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message);
      }

      // Track Token Usage
      if (data.usage) {
        gemmaInputTokens += data.usage.prompt_tokens || 0;
        gemmaOutputTokens += data.usage.completion_tokens || 0;
      }

      let content = data.choices[0].message.content.trim();
      if (content.startsWith("```json")) {
        content = content.substring(7, content.length - 3).trim();
      } else if (content.startsWith("```")) {
        content = content.substring(3, content.length - 3).trim();
      }

      return JSON.parse(content);
    } catch (err) {
      console.warn(`⚠️ Warning: Parse attempt failed. Retrying... (${retries} retries left). Error: ${err.message}`);
      retries--;
      await delay(2000);
    }
  }
  return [];
}

// Generate vector embedding for a piece of text (1536 dimensions)
async function getVectorEmbedding(text) {
  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(OPENROUTER_EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({
          model: EMBED_MODEL,
          input: text
        })
      });

      const data = await response.json();
      
      // Track embedding token usage
      if (data.usage) {
        embeddingTokens += data.usage.total_tokens || 0;
      }

      if (data.data && data.data[0] && data.data[0].embedding) {
        return data.data[0].embedding;
      }
      throw new Error("No embedding in response: " + JSON.stringify(data));
    } catch (err) {
      console.warn(`⚠️ Warning: Embedding attempt failed. Retrying... (${retries} retries left). Error: ${err.message}`);
      retries--;
      await delay(2000);
    }
  }
  return null;
}

// Main execution loop
async function run() {
  console.log("🚀 Starting Multimodal Press Machine Guideline Indexing...");
  
  const pdfPath = path.join(__dirname, 'legislation', 'garis-panduan-keselamatan-industri', 'Guidelines-on-Safe-Use-of-Press-Machines-2015.pdf');
  
  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ PDF not found at: ${pdfPath}`);
    process.exit(1);
  }

  const fileName = path.basename(pdfPath);
  console.log(`📄 Target File: ${fileName}`);

  try {
    const dataBuffer = fs.readFileSync(pdfPath);
    const pdfObj = new PDFParse({ data: dataBuffer });
    const info = await pdfObj.getInfo();
    const totalPages = info.total;
    console.log(`📄 Total Pages to process: ${totalPages}`);

    // 1. Insert Document record into Supabase
    const { data: docRow, error: docError } = await supabase
      .from('documents')
      .insert({
        name: `${fileName} (Multimodal Test)`,
        type: 'Guideline',
        category_path: 'garis-panduan-keselamatan-industri'
      })
      .select()
      .single();

    if (docError) throw new Error("Database error inserting document: " + docError.message);
    const docId = docRow.id;
    console.log(`✅ Document created with ID: ${docId}`);

    // 2. Process Page-by-Page
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      console.log(`\n📖 [${pageNum}/${totalPages}] Processing Page ${pageNum}...`);

      // Extract text of this single page
      const textResult = await pdfObj.getText({ first: pageNum, last: pageNum });
      const pageText = textResult.pages[0]?.text?.trim() || "";

      // Extract images of this single page
      const imgResult = await pdfObj.getImage({ first: pageNum, last: pageNum, imageDataUrl: true });
      const pageImages = imgResult.pages[0]?.images || [];
      const imageBase64 = pageImages.length > 0 ? pageImages[0].dataUrl : null;

      if (!pageText && !imageBase64) {
        console.log(`   - Page ${pageNum} is empty. Skipping.`);
        continue;
      }

      if (imageBase64) {
        console.log(`   - Found embedded safety diagram. Dimensions: ${pageImages[0].width}x${pageImages[0].height}`);
      }

      // Call Gemma 4 vision model
      console.log("   - Querying Gemma 4 vision API...");
      const clauses = await parsePageMultimodal(pageText, imageBase64, pageNum);

      if (!Array.isArray(clauses) || clauses.length === 0) {
        console.log("   - No safety rules extracted from this page.");
        continue;
      }

      console.log(`   - Extracted ${clauses.length} rules. Saving to database...`);
      totalClausesExtracted += clauses.length;

      for (const item of clauses) {
        const sectionNum = item.section_number || `Page ${pageNum}`;
        const clauseText = item.clause_text || "";
        if (!clauseText) continue;

        // Get embedding
        const embedding = await getVectorEmbedding(clauseText);
        if (!embedding) continue;

        // Insert clause
        const { data: clauseRow, error: clauseError } = await supabase
          .from('clauses')
          .insert({
            doc_id: docId,
            section_number: sectionNum,
            clause_text: clauseText,
            embedding: embedding,
            parent_citations: []
          })
          .select()
          .single();

        if (clauseError) {
          console.error("   - DB error inserting clause:", clauseError.message);
          continue;
        }

        // Insert obligation
        const { error: oblError } = await supabase
          .from('obligations')
          .insert({
            clause_id: clauseRow.id,
            trigger_activity: item.trigger_activity || "press machine operation",
            required_action: item.required_action || "",
            frequency: item.frequency || "continuous",
            legal_weight: 'recommended' // guidelines are voluntary recommendations
          });

        if (oblError) {
          console.error("   - DB error inserting obligation:", oblError.message);
        }
      }

      // Print live token consumption status
      console.log(`   📊 Cumulative Token Usage:`);
      console.log(`     - Gemma 4 Input: ${gemmaInputTokens} tokens`);
      console.log(`     - Gemma 4 Output: ${gemmaOutputTokens} tokens`);
      console.log(`     - Embeddings: ${embeddingTokens} tokens`);

      // Throttle
      await delay(1000);
    }

    console.log("\n==========================================");
    console.log("🎉 Multimodal Indexing Experiment Complete!");
    console.log(`📄 Total Pages Processed: ${totalPages}`);
    console.log(`⚡ Total Clauses Extracted: ${totalClausesExtracted}`);
    console.log("📊 FINAL TOKEN CONSUMPTION:");
    console.log(`   - Gemma 4 (Vision) Input Tokens:  ${gemmaInputTokens}`);
    console.log(`   - Gemma 4 (Vision) Output Tokens: ${gemmaOutputTokens}`);
    console.log(`   - Embeddings Input Tokens:        ${embeddingTokens}`);
    
    // Estimate costs based on OpenRouter average prices:
    // Gemma 4: Input $0.20 / million, Output $0.40 / million
    // Embeddings: Input $0.02 / million
    const gemmaCost = (gemmaInputTokens * 0.0000002) + (gemmaOutputTokens * 0.0000004);
    const embedCost = embeddingTokens * 0.00000002;
    const totalCost = gemmaCost + embedCost;
    
    console.log(`💰 Estimated API Cost: $${totalCost.toFixed(4)} USD`);
    console.log("==========================================");

  } catch (err) {
    console.error("❌ Processing failed:", err.message);
  }
}

run();
