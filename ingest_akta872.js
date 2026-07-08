import 'dotenv/config';
import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENROUTER_API_KEY) {
  console.error("Missing environment variables in .env file.");
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const EMBED_MODEL = "openai/text-embedding-3-small";

const DOC_NAME = "Akta-872-AKTA-PEKERJA-GIG-2025.pdf";
const TEXTPATH = "/tmp/akta872_text.txt";

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PAGE_HEADER_PATTERNS = [
  /^keselamatan dan kesihatan pekerjaan$/i,
  /^undang-undang malaysia$/i,
  /^akta 514$/i,
  /^versi dalam talian teks$/i,
  /^cetakan semula yang kemas kini$/i,
  /^susunan seksyen$/i,
  /^senarai pindaan$/i,
  /^akta keselamatan dan$/i,
  /^kesihatan pekerjaan 1994$/i,
  /^sebagaimana pada 1 jun 2024$/i,
  /^teks ini hanyalah teks kemas kini$/i,
];

function shouldSkip(line) {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\d{1,4}$/.test(trimmed)) return true;
  if (trimmed === '\f' || trimmed.startsWith('\f')) return true;
  for (const pattern of PAGE_HEADER_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }
  if (/^p\.u\.?\s*\(/.test(trimmed.toLowerCase())) return true;
  return false;
}

const SECTION_RE = /^([1-9]\d*[A-Z]?)\.\s*(.*)/;
const SUBSECTION_RE = /^\((\d+)\)\s*/;
const PARAGRAPH_RE = /^\(([a-z])\)\s*/;
const SCHEDULE_RE = /^[Jj]adual\s*(PERTAMA|KEDUA|KETIGA|KEEMPAT|KELIMA)?\s*/;
const SCHEDULE_ITEM_RE = /^(\d+)\.\s*(.*)/;
const SCHEDULE_SUBITEM_RE = /^\((\d+)\)\s*/;

const DOT_RE = /^\(?Dipotong oleh Akta/;

function findContentStart(lines) {
  for (let i = 0; i < lines.length; i++) {
    if (/^1\.\s*\(1\)/.test(lines[i].trim())) return i;
  }
  return 0;
}

function buildRef(stack) {
  return stack.map(s => s.label).join('');
}

function parseText(raw) {
  const lines = raw.split('\n');
  let schedule = null;
  let stack = [];
  const output = [];
  let buf = null;

  let currentSectionTitle = '';

  function flush() {
    if (buf) {
      const t = buf.text.join(' ').replace(/\s+/g, ' ').trim();
      if (t) output.push({ ref: buf.ref, text: t });
      buf = null;
    }
  }

  function addRef(text) {
    const ref = buildRef(stack) || 'Preamble';
    if (!buf || buf.ref !== ref) flush();
    if (!buf) {
      buf = { ref, text: [] };
      if (ref.startsWith('Section ') && !schedule && currentSectionTitle) {
        buf.text.push(currentSectionTitle + ' —');
      }
    }
    buf.text.push(text);
  }

  const contentStart = findContentStart(lines);
  for (let i = contentStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (shouldSkip(lines[i])) continue;
    if (DOT_RE.test(line)) { flush(); continue; }

    const schedMatch = line.match(SCHEDULE_RE);
    if (schedMatch) {
      flush();
      schedule = schedMatch[1] || 'PERTAMA';
      stack = [{ label: 'Jadual ' + schedule }];
      currentSectionTitle = ''; // clear when in schedule
      const remaining = line.slice(schedMatch[0].length).trim();
      if (remaining) addRef(remaining);
      continue;
    }

    const secMatch = line.match(SECTION_RE);
    if (secMatch && !schedule) {
      // 1. Look back to extract section title from previous lines
      let titleLines = [];
      let k = i - 1;
      while (k >= contentStart) {
        const rawLine = lines[k];
        const trimmed = rawLine.trim();
        if (shouldSkip(rawLine)) {
          k--;
          continue;
        }
        if (!trimmed) {
          break; // stop at empty line
        }
        // Stop if we hit a sentence ending in a previous line
        if (k < i - 1 && (trimmed.endsWith('.') || trimmed.endsWith(';') || trimmed.endsWith('”') || trimmed.endsWith(')'))) {
          break;
        }
        titleLines.unshift(trimmed);
        k--;
      }

      const sectionTitle = titleLines.join(' ').replace(/\s+/g, ' ').trim();

      // 2. Remove the title lines from the previous buffer if they were appended
      if (sectionTitle && buf && buf.text) {
        let matches = true;
        for (let j = 0; j < titleLines.length; j++) {
          const bufIdx = buf.text.length - titleLines.length + j;
          if (bufIdx < 0 || buf.text[bufIdx] !== titleLines[j]) {
            matches = false;
            break;
          }
        }
        if (matches) {
          buf.text.splice(buf.text.length - titleLines.length, titleLines.length);
        }
      }

      flush();

      let secNum = secMatch[1];
      let rest = secMatch[2].trim();

      currentSectionTitle = sectionTitle;

      // Check if rest starts with a subsection like "(1)"
      const subMatch = rest.match(SUBSECTION_RE);
      if (subMatch) {
        stack = [{ label: 'Section ' + secNum }, { label: '(' + subMatch[1] + ')' }];
        rest = rest.slice(subMatch[0].length).trim();
      } else {
        stack = [{ label: 'Section ' + secNum }];
      }
      if (rest) addRef(rest);
      continue;
    }

    if (/^BAHAGIAN\s+/.test(line)) {
      flush();
      stack = [];
      continue;
    }

    // === Within a schedule ===
    if (schedule) {
      const schedItemMatch = line.match(SCHEDULE_ITEM_RE);
      if (schedItemMatch) {
        flush();
        stack = [{ label: 'Jadual ' + schedule }, { label: ', Item ' + schedItemMatch[1] }];
        const rest = schedItemMatch[2].trim();
        if (rest) addRef(rest);
        continue;
      }

      const schedParaMatch = line.match(PARAGRAPH_RE);
      if (schedParaMatch && stack.length >= 2) {
        flush();
        while (stack.length > 2) stack.pop();
        stack.push({ label: '(' + schedParaMatch[1] + ')' });
        const rest = line.slice(schedParaMatch[0].length).trim();
        if (rest) addRef(rest);
        continue;
      }

      const schedSubMatch = line.match(SUBSECTION_RE);
      if (schedSubMatch && schedule) {
        flush();
        if (stack.length > 1 && stack[stack.length - 1].label.startsWith(', Item')) {
          // keep item as parent
        } else {
          while (stack.length > 2) stack.pop();
        }
        stack.push({ label: '(' + schedSubMatch[1] + ')' });
        const rest = line.slice(schedSubMatch[0].length).trim();
        if (rest) addRef(rest);
        continue;
      }

      if (stack.length > 0) { addRef(line); }
      continue;
    }

    // === Section content ===

    // Subsection: (1), (2) — pops paragraph level, replaces at depth 1
    if (SUBSECTION_RE.test(line)) {
      const m = line.match(SUBSECTION_RE);
      flush();
      while (stack.length > 1) stack.pop(); // pop to section level
      stack.push({ label: '(' + m[1] + ')' });
      const rest = line.slice(m[0].length).trim();
      if (rest) addRef(rest);
      continue;
    }

    // Paragraph: (a), (b) etc.
    if (PARAGRAPH_RE.test(line)) {
      const m = line.match(PARAGRAPH_RE);
      flush();
      // Pop to the level above paragraph (depth 1 if at section, depth 2 if at subsection)
      while (stack.length > 1 && /^\([a-z]\)$/.test(stack[stack.length - 1].label)) {
        stack.pop();
      }
      stack.push({ label: '(' + m[1] + ')' });
      const rest = line.slice(m[0].length).trim();
      if (rest) addRef(rest);
      continue;
    }

    // Regular content
    if (stack.length > 0) {
      addRef(line);
    }
  }

  flush();
  return output;
}

async function getVectorEmbedding(text) {
  for (let retries = 3; retries > 0; retries--) {
    try {
      const response = await fetch(OPENROUTER_EMBED_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: text })
      });
      const data = await response.json();
      if (data.data?.[0]?.embedding) return data.data[0].embedding;
    } catch (err) {
      console.warn(`Embedding retry ${retries}: ${err.message}`);
      await delay(2000);
    }
  }
  return null;
}

async function run() {
  console.log("Parsing Akta 872 text...");
  const raw = fs.readFileSync(TEXTPATH, 'utf-8');
  const parsed = parseText(raw);
  console.log(`Extracted ${parsed.length} raw segments.`);

  // Merge duplicates (same ref, concatenate text)
  const merged = new Map();
  for (const p of parsed) {
    if (merged.has(p.ref)) {
      merged.get(p.ref).push(p.text);
    } else {
      merged.set(p.ref, [p.text]);
    }
  }

  const clauses = [];
  for (const [ref, texts] of merged) {
    const combined = texts.join(' ').replace(/\s+/g, ' ').trim();
    // Skip preamble and empty
    if (ref === 'Preamble' || !combined) continue;
    // Skip headers and standalone "Table of Contents" lines
    if ((/^[A-Z\s]{10,}$/.test(combined) || combined === ref)) {
      // Check if it's a real section heading with meaningful text
      const hasContent = texts.some(t => t.length > 10 && !/^[A-Z\s,]+$/.test(t));
      if (!hasContent) continue;
    }
    clauses.push({ ref, text: combined });
  }

  console.log(`After merge: ${clauses.length} unique clauses.`);

  // Verify key sections
  const sec15 = clauses.filter(c => c.ref.includes('Section 15'));
  console.log(`\nSection 15 entries: ${sec15.length}`);
  sec15.forEach(c => console.log(`  ${c.ref}`));

  const sec4 = clauses.filter(c => c.ref.startsWith('Section 4') && !c.ref.startsWith('Section 40') && !c.ref.startsWith('Section 41') && !c.ref.startsWith('Section 42') && !c.ref.startsWith('Section 43') && !c.ref.startsWith('Section 44') && !c.ref.startsWith('Section 45') && !c.ref.startsWith('Section 46') && !c.ref.startsWith('Section 47') && !c.ref.startsWith('Section 48') && !c.ref.startsWith('Section 49') && !c.ref.startsWith('Section 4)'));
  console.log(`\nSection 4 entries: ${sec4.length}`);
  sec4.forEach(c => console.log(`  ${c.ref}: ${c.text.substring(0, 80)}`));

  const sec39 = clauses.filter(c => c.ref.startsWith('Section 39'));
  console.log(`\nSection 39 entries: ${sec39.length}`);
  sec39.forEach(c => console.log(`  ${c.ref}: ${c.text.substring(0, 80)}`));

  const sec22 = clauses.filter(c => c.ref.startsWith('Section 22'));
  console.log(`\nSection 22 entries: ${sec22.length}`);
  sec22.forEach(c => console.log(`  ${c.ref}: ${c.text.substring(0, 80)}`));

  // Check for any remaining Section (5) or Section (tb) artifacts
  const artifacts = clauses.filter(c => /Section \(\d\)/.test(c.ref) || /\(tb\)/.test(c.ref));
  if (artifacts.length > 0) {
    console.log(`\n⚠️ Artifact entries: ${artifacts.length}`);
    artifacts.forEach(c => console.log(`  ${c.ref}`));
  }

  // Check duplicate refs
  const refCounts = {};
  for (const c of clauses) {
    refCounts[c.ref] = (refCounts[c.ref] || 0) + 1;
  }
  const dupes = Object.entries(refCounts).filter(([k, v]) => v > 1);
  console.log(`\nDuplicate refs: ${dupes.length}`);
  if (dupes.length > 0) {
    dupes.slice(0, 10).forEach(([k, v]) => console.log(`  ${k} (${v}x)`));
  }

  // Find document
  const { data: docs } = await supabase
    .from('documents')
    .select('id')
    .eq('name', DOC_NAME);

  if (!docs || docs.length === 0) {
    console.error("Document not found in database. Run main ingestion first.");
    process.exit(1);
  }
  const docId = docs[0].id;
  console.log(`\nDocument ID: ${docId}`);

  // Ask for confirmation before writing
  console.log("\nReady to clear and re-insert. Press Ctrl+C to abort or wait 5s...");
  await delay(5000);

  // Delete existing
  console.log("Clearing existing data...");
  const { data: existingClauses } = await supabase
    .from('clauses')
    .select('id, section_number')
    .eq('doc_id', docId);

  if (existingClauses && existingClauses.length > 0) {
    const targetClauses = existingClauses.filter(c => c.section_number.startsWith('Section '));
    const ids = targetClauses.map(c => c.id);
    
    if (ids.length > 0) {
      const { error: delObl } = await supabase
        .from('obligations')
        .delete()
        .in('clause_id', ids);
      if (delObl) console.error("Error deleting obligations:", delObl.message);

      const { error: delCl } = await supabase
        .from('clauses')
        .delete()
        .in('id', ids);
      if (delCl) console.error("Error deleting clauses:", delCl.message);
      console.log(`Deleted ${ids.length} existing section clauses + obligations.`);
    } else {
      console.log("No existing section clauses to delete.");
    }
  }

  // Insert
  let inserted = 0;
  let errors = 0;

  for (let i = 0; i < clauses.length; i++) {
    const c = clauses[i];
    process.stdout.write(`[${i + 1}/${clauses.length}] ${c.ref}... `);

    if (c.ref.startsWith('Jadual')) {
      console.log('➡️ skip (schedule entry preserved in DB)');
      continue;
    }

    const embedding = await getVectorEmbedding(c.text);
    if (!embedding) {
      console.log('⚠️ skip (embedding failed)');
      errors++;
      continue;
    }

    const { data: clauseRow, error: clauseErr } = await supabase
      .from('clauses')
      .insert({
        doc_id: docId,
        section_number: c.ref,
        clause_text: c.text,
        embedding: embedding,
        parent_citations: []
      })
      .select()
      .single();

    if (clauseErr) {
      console.log('❌ ' + clauseErr.message);
      errors++;
      continue;
    }

    const { error: oblErr } = await supabase
      .from('obligations')
      .insert({
        clause_id: clauseRow.id,
        trigger_activity: "general compliance",
        required_action: c.text,
        frequency: "continuous",
        legal_weight: "mandatory"
      });

    if (oblErr) console.log('⚠️ oblg err: ' + oblErr.message);

    console.log('✅');
    inserted++;
    await delay(300);
  }

  console.log(`\nDone. Inserted ${inserted} clauses, ${errors} errors.`);
}

run().catch(console.error);
