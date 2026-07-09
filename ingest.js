import 'dotenv/config';
import fs from 'fs';
import path from 'url'; // wait, import path from 'path'!
import { fileURLToPath } from 'url';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';
import pathModule from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathModule.dirname(__filename);

// Verify Env Keys
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENROUTER_API_KEY) {
  console.error("❌ Missing environment variables in .env file.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_API_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const MODEL_NAME = process.env.OPENROUTER_MODEL || "google/gemma-2-27b-it";
const EMBED_MODEL = "openai/text-embedding-3-small"; // 1536 dimensions

// Helper to delay requests (prevents API rate limits)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Recursive folder scanning to find all PDFs
function getFilesRecursively(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = pathModule.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      getFilesRecursively(filePath, fileList);
    } else if (file.toLowerCase().endsWith('.pdf')) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

// Identify document type based on parent folder name
function determineDocumentType(filePath) {
  const relativePath = pathModule.relative(pathModule.join(__dirname, 'legislation'), filePath);
  const topFolder = relativePath.split(pathModule.sep)[0].toLowerCase();
  
  if (topFolder === 'akta') return 'Act';
  if (topFolder.startsWith('peraturan')) return 'Regulation';
  if (topFolder.startsWith('tataamalan')) return 'ICOP';
  if (topFolder.startsWith('garis-panduan')) return 'Guideline';
  if (topFolder.startsWith('perintah')) return 'Order';
  if (topFolder.startsWith('surat-arahan')) return 'Directive';
  return 'Other';
}

// Call OpenRouter to parse OSH text into structured JSON clauses
async function parseTextWithAI(textChunk, docType) {
  const systemPrompt = `You are an expert Occupational Safety and Health (OSH) legal analyst. 
Your task is to analyze the provided text chunk from a safety ${docType} document, extract all legal requirements/clauses, and translate them into structured compliance tasks.

Only extract clauses that contain actual safety obligations, inspections, permits, equipment rules, or operational procedures for workers/employers. Ignore purely administrative clauses (like the powers of the Minister, court proceedings, general definitions, or repeals) to keep the data clean and focused.

For each clause/requirement identified, extract:
1. "section_number": The exact section number or regulation name (e.g., "Section 15(1)", "Regulation 12").
2. "clause_text": The literal text of the clause or a very close summary if too long.
3. "trigger_activity": The worker/operational activity that triggers this law (e.g., "working at heights", "chemical handling", "fire drill"). Keep this keyword-focused and lowercase.
4. "required_action": A simplified, plain-language checklist instruction of what the employer must do to comply.
5. "frequency": How often this must be done. Must be one of: "daily", "weekly", "monthly", "annually", "once", or "continuous".
6. "parent_citations": Array of strings referencing parent laws (e.g., ["OSHA 1994 Section 15"] or empty []).

Your response MUST be a valid JSON array of objects. Do not include any markdown comments, backticks, or text before or after the JSON.
Example output format:
[
  {
    "section_number": "Section 30",
    "clause_text": "Every employer with more than 40 employees shall establish a safety committee...",
    "trigger_activity": "safety committee management",
    "required_action": "Establish a joint safety and health committee with employer and employee representatives.",
    "frequency": "once",
    "parent_citations": []
  }
]`;

  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
          "HTTP-Referer": "https://amerispro.com",
          "X-Title": "AmerisPro Compliance Engine"
        },
        body: JSON.stringify({
          model: MODEL_NAME,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `Analyze the following text chunk:\n\n${textChunk}` }
          ],
          temperature: 0.1,
          max_tokens: 4096
        })
      });

      const data = await response.json();
      if (!data.choices || data.choices.length === 0) {
        throw new Error("Invalid API response from OpenRouter: " + JSON.stringify(data));
      }

      let content = data.choices[0].message.content.trim();
      // Remove any markdown code fence blocks if returned
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

// Main processing loop
async function run() {
  console.log("🚀 Starting OSH Compliance Ingestion Engine...");
  const legislationDir = pathModule.join(__dirname, 'legislation');
  
  if (!fs.existsSync(legislationDir)) {
    console.error("❌ The 'legislation' folder does not exist.");
    process.exit(1);
  }

  const pdfFiles = getFilesRecursively(legislationDir);
  console.log(`📁 Found ${pdfFiles.length} PDF files to process.`);

  for (let i = 0; i < pdfFiles.length; i++) {
    const filePath = pdfFiles[i];
    const fileName = pathModule.basename(filePath);
    const docType = determineDocumentType(filePath);
    const relativeDir = pathModule.dirname(pathModule.relative(legislationDir, filePath));

    if (docType === 'Guideline') {
      console.log(`\n📄 [${i + 1}/${pdfFiles.length}] Skipping Guideline: ${fileName} (saved for visual pipeline)`);
      continue;
    }

    console.log(`\n📄 [${i + 1}/${pdfFiles.length}] Processing: ${fileName} (${docType}) in category: ${relativeDir}`);

    try {
      // Check if document already exists in DB to prevent duplicates
      const { data: existingDocs, error: checkError } = await supabase
        .from('documents')
        .select('id')
        .eq('name', fileName)
        .limit(1);

      if (existingDocs && existingDocs.length > 0) {
        console.log(`   - ⏭️ Document already exists in database. Skipping.`);
        continue;
      }

      // 1. Parse PDF text
      const dataBuffer = fs.readFileSync(filePath);
      const parser = new PDFParse({ data: dataBuffer });
      const textResult = await parser.getText();
      const fullText = textResult.text.trim();

      if (!fullText) {
        console.warn(`⚠️ Warning: Empty text extracted from ${fileName}. Skipping.`);
        continue;
      }

      // 2. Insert Document row into Supabase
      const { data: docRow, error: docError } = await supabase
        .from('documents')
        .insert({
          name: fileName,
          type: docType,
          category_path: relativeDir
        })
        .select()
        .single();

      if (docError) throw new Error("Database error inserting document: " + docError.message);
      const docId = docRow.id;

      // 3. Chunk text (split into blocks of roughly 2000 characters to keep prompts clean)
      const chunkSize = 2000;
      const chunks = [];
      for (let i = 0; i < fullText.length; i += chunkSize) {
        chunks.push(fullText.substring(i, i + chunkSize));
      }

      console.log(`   - Split document into ${chunks.length} text chunks. Parsing with OpenRouter (${MODEL_NAME})...`);

      // 4. Send chunks to AI and insert results
      for (let c = 0; c < chunks.length; c++) {
        console.log(`   - Parsing chunk [${c + 1}/${chunks.length}]...`);
        const clauses = await parseTextWithAI(chunks[c], docType);

        if (!Array.isArray(clauses) || clauses.length === 0) {
          console.log(`   - No clauses extracted from chunk [${c + 1}/${chunks.length}]`);
          continue;
        }

        console.log(`   - Extracted ${clauses.length} clauses. Generating embeddings & inserting to database...`);
        
        for (const item of clauses) {
          const sectionNum = item.section_number || "Unknown";
          const clauseText = item.clause_text || "";
          
          if (!clauseText) continue;

          // Generate vector embeddings
          const embedding = await getVectorEmbedding(clauseText);
          
          if (!embedding) {
            console.warn(`   - Failed to generate embedding for clause: ${sectionNum}. Skipping.`);
            continue;
          }

          // Insert into clauses table
          const { data: clauseRow, error: clauseError } = await supabase
            .from('clauses')
            .insert({
              doc_id: docId,
              section_number: sectionNum,
              clause_text: clauseText,
              embedding: embedding,
              parent_citations: item.parent_citations || []
            })
            .select()
            .single();

          if (clauseError) {
            console.error("   - Database error inserting clause:", clauseError.message);
            continue;
          }

          // Determine legal weight based on document type
          let legalWeight = "recommended";
          if (docType === 'Act' || docType === 'Regulation' || docType === 'Order') legalWeight = 'mandatory';
          else if (docType === 'ICOP') legalWeight = 'warning';

          // Insert into obligations table
          const { error: oblError } = await supabase
            .from('obligations')
            .insert({
              clause_id: clauseRow.id,
              trigger_activity: item.trigger_activity || "general safety",
              required_action: item.required_action || "",
              frequency: item.frequency || "continuous",
              legal_weight: legalWeight
            });

          if (oblError) {
            console.error("   - Database error inserting obligation:", oblError.message);
          }
        }
        
        // Throttling to prevent API rate limits
        await delay(1000);
      }

      console.log(`   ✅ Finished processing: ${fileName}`);

    } catch (err) {
      console.error(`❌ Failed to process document ${fileName}:`, err.message);
    }
  }

  console.log("\n🎉 Compliance Indexing Complete!");
}

run();
