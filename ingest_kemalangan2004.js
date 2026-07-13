import 'dotenv/config';
import fs from 'fs';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_NAME = 'Peraturan-Keselamatan-dan-Kesihatan-Pekerjaan-Pemberitahuan-Mengenai-Kemalangan-Kejadian-Berbahaya-Keracunan-Pekerjaan-dan-Penyakit-Pekerjaan-2004.pdf';
const PDF_PATH = path.join(__dirname, 'legislation', 'peraturan-akta514', PDF_NAME);
const TMP_TXT = '/tmp/kemalangan2004_text.txt';
const DOC_TYPE = 'Regulation';
const CATEGORY = 'peraturan-akta514';

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.OPENROUTER_API_KEY) {
  console.error('❌ Missing env vars in .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OPENROUTER_EMBED_URL = 'https://openrouter.ai/api/v1/embeddings';
const EMBED_MODEL = 'openai/text-embedding-3-small';
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const clean = (s) => s.replace(/\s+/g, ' ').trim();

function extractText() {
  console.log('📄 Extracting text via pdftotext -layout...');
  execSync(`pdftotext -layout "${PDF_PATH}" ${TMP_TXT}`);
  return fs.readFileSync(TMP_TXT, 'utf8');
}

function parsePeraturan(bodyText) {
  const lines = bodyText.split('\n');
  const sections = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const m = /^(\d+)\.\s+/.exec(line);
    if (!m) { i++; continue; }
    const num = m[1];

    let title = null;
    for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
      const prev = lines[j].trim();
      if (!prev) continue;
      if (/^BAHAGIAN\s/.test(prev) || /^PADA\s/.test(prev) || /^PERMULAAN$/.test(prev) || /^PELBAGAI$/.test(prev)) continue;
      if (/^\d+\.\s+/.test(prev)) break;
      if (/^[A-Z]/.test(prev) && !/^\d/.test(prev)) { title = prev; break; }
    }

    let endIdx = lines.length;
    for (let k = i + 1; k < lines.length; k++) {
      const next = lines[k].trim();
      if (/^JADUAL\s/.test(next) || /^\d+\.\s+/.test(next)) { endIdx = k; break; }
    }

    sections.push({ number: num, title, lines: lines.slice(i, endIdx) });
    i = endIdx;
  }
  return sections;
}

function parseSection(section) {
  const { number, title, lines } = section;
  const clauses = [];

  if (title) {
    clauses.push({ section_number: `Section ${number}`, clause_text: `${title} (Peraturan ${number})` });
  }

  if (number === '2') {
    return parseSection2(section, clauses);
  }

  const subs = collectSubsections(lines, number);
  for (const sub of subs) {
    clauses.push(...sub);
  }
  return clauses;
}

function collectSubsections(lines, sectionNum) {
  const subs = [];
  let currentSub = null;

  const flushSub = () => {
    if (currentSub) {
      if (currentSub.num === null) {
        subs.push([{ section_number: `Section ${sectionNum}`, clause_text: clean(currentSub.mainText) }]);
      } else {
        const clauses = [];
        if (currentSub.mainText) clauses.push({ section_number: `Section ${sectionNum}(${currentSub.num})`, clause_text: clean(currentSub.mainText) });
        for (const sp of currentSub.subParas) {
          clauses.push({ section_number: `Section ${sectionNum}(${currentSub.num})(${sp.label})`, clause_text: clean(sp.text) });
        }
        subs.push(clauses);
      }
      currentSub = null;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const newSubMatch = /^\s*\((\d+)\)\s+([A-Z].*)/.exec(line);
    if (newSubMatch) {
      flushSub();
      currentSub = { num: newSubMatch[1], mainText: newSubMatch[2], subParas: [] };
      continue;
    }

    if (!currentSub) {
      const m = new RegExp(`^${sectionNum}\\.\\s+(.*)`).exec(line);
      if (m) {
        const body = m[1];
        const subMatch = /^\((\d+)\)\s+(.*)/.exec(body);
        if (subMatch) {
          currentSub = { num: subMatch[1], mainText: subMatch[2], subParas: [] };
        } else {
          currentSub = { num: null, mainText: body, subParas: [] };
        }
      }
      continue;
    }

    if (currentSub.num === null) {
      if (/^\d+\.\s+/.test(line)) {
        subs.push([{ section_number: `Section ${sectionNum}`, clause_text: clean(currentSub.mainText) }]);
        currentSub = null;
        i--;
        continue;
      }
      currentSub.mainText += ' ' + line;
      continue;
    }

    const subParaMatch = /^\s*\(([a-z]{1,3})\)\s+(.*)/.exec(line);
    if (subParaMatch) {
      currentSub.subParas.push({ label: subParaMatch[1], text: subParaMatch[2] });
      continue;
    }

    if (/^\d+\.\s+/.test(line)) break;

    if (currentSub.subParas.length > 0) {
      const last = currentSub.subParas[currentSub.subParas.length - 1];
      last.text += ' ' + line;
    } else {
      currentSub.mainText += ' ' + line;
    }
  }
  flushSub();
  return subs;
}

function parseSection2(section, initialClauses) {
  const { number, lines } = section;
  const out = [...initialClauses];

  let mode = 'init';
  let currentDef = null;
  let subsection21Main = '';
  let subsection22Text = '';

  const flushDef = () => {
    if (currentDef) {
      out.push({
        section_number: `Section 2(1) "${currentDef.term}"`,
        clause_text: clean(currentDef.text)
      });
    }
    currentDef = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (/^2\.\s+/.test(line)) {
      const body = line.replace(/^2\.\s+/, '');
      const subMatch = /^\((\d+)\)\s+(.*)/.exec(body);
      if (subMatch) {
        if (subMatch[1] === '1') {
          mode = 'in2_1';
          subsection21Main = subMatch[2];
        } else if (subMatch[1] === '2') {
          mode = 'in2_2';
          subsection22Text = subMatch[2];
        }
      }
      continue;
    }

    if (mode === 'in2_1') {
      const defMatch = /^[“"]([^”"]+)[”"]\s+ertinya\s*(.*)/.exec(line);
      const altDefMatch = /^[“"]([^”"]+)[”"]\s+mempunyai\s+erti\s+yang\s+sama\s*(.*)/.exec(line);
      const m = defMatch || altDefMatch;
      if (m) {
        flushDef();
        const phrase = defMatch ? 'ertinya' : 'mempunyai erti yang sama';
        currentDef = { term: m[1], text: `"${m[1]}" ${phrase} ${m[2]}`.trim() };
        continue;
      }

      if (currentDef) {
        currentDef.text += ' ' + line;
        continue;
      }

      subsection21Main += ' ' + line;
      continue;
    }

    if (mode === 'in2_2') {
      subsection22Text += ' ' + line;
    }
  }
  flushDef();

  if (subsection21Main) {
    out.push({ section_number: 'Section 2(1)', clause_text: clean(subsection21Main) });
  }
  if (subsection22Text) {
    out.push({ section_number: 'Section 2(2)', clause_text: clean(subsection22Text) });
  }
  return out;
}

function findColumnSplit(text) {
  const m = /^(.+?)\s{3,}(.+)$/.exec(text);
  return m ? m[1].length : -1;
}

function parseJadual(jadualText) {
  const clauses = [];
  const lines = jadualText.split('\n');
  const jadualSections = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const m = /^JADUAL\s+(PERTAMA|KEDUA|KETIGA|KEEMPAT)\s*$/.exec(line);
    if (!m) { i++; continue; }
    const name = m[1];
    let j = i + 1;
    let ref = null, title = null;
    while (j < lines.length && !lines[j].trim()) j++;
    if (j < lines.length) {
      const refLine = lines[j].trim();
      const refMatch = /^\[([^\]]+)\]$/.exec(refLine);
      if (refMatch) {
        ref = refMatch[1];
        j++;
        while (j < lines.length && !lines[j].trim()) j++;
        const titleLines = [];
        while (j < lines.length && lines[j].trim() && !/^JADUAL\s+/.test(lines[j].trim())) {
          const t = lines[j].trim();
          if (/^\d+\.\s+/.test(t) || /^BAHAGIAN\s+/.test(t)) break;
          titleLines.push(t);
          j++;
        }
        title = clean(titleLines.join(' '));
      }
    }
    let endIdx = lines.length;
    for (let k = j; k < lines.length; k++) {
      if (/^JADUAL\s+(?:PERTAMA|KEDUA|KETIGA|KEEMPAT)\s*$/.test(lines[k].trim())) {
        endIdx = k; break;
      }
    }
    jadualSections.push({ name, ref, title, bodyLines: lines.slice(j, endIdx) });
    i = endIdx;
  }
  for (const j of jadualSections) {
    const header = `${j.title || ''}${j.ref ? ` [${j.ref}]` : ''}`.trim();
    if (header) clauses.push({ section_number: `Jadual ${j.name}`, clause_text: `Jadual ${j.name} – ${header}` });
    if (j.name === 'PERTAMA' || j.name === 'KEEMPAT') {
      const items = parseNumberedList(j.bodyLines);
      items.forEach((it) => clauses.push({
        section_number: `Jadual ${j.name} Item ${it.num}`,
        clause_text: clean(`${it.num}. ${it.text}`)
      }));
    } else if (j.name === 'KEDUA') {
      clauses.push(...parseJadualKedua(j.bodyLines, j.name));
    } else if (j.name === 'KETIGA') {
      clauses.push(...parseJadualKetiga(j.bodyLines, j.name));
    }
  }
  return clauses;
}

function parseNumberedList(lines) {
  const items = [];
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d+)\.\s+(.*)/.exec(line);
    if (m) { if (current) items.push(current); current = { num: m[1], text: m[2] }; }
    else if (current && !/^BAHAGIAN\s+/.test(line)) current.text += ' ' + line;
  }
  if (current) items.push(current);
  return items;
}

function parseJadualKedua(lines, jadualName) {
  const clauses = [];
  let currentBahagian = null, currentCategory = null, currentItem = null;
  const flushItem = () => {
    if (currentItem) {
      const sectionNum = `Jadual ${jadualName}${currentBahagian ? ` Bahagian ${currentBahagian}` : ''}${currentCategory ? ` (${currentCategory})` : ''} Item ${currentItem.num}`;
      clauses.push({ section_number: sectionNum, clause_text: clean(`${currentItem.num}. ${currentItem.text}`) });
    }
    currentItem = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BAHAGIAN\s+[IVX]+\s*$/.test(line)) { flushItem(); currentBahagian = line.replace(/^BAHAGIAN\s+/, '').trim(); currentCategory = null; continue; }
    if (/^Dibuat\s+/.test(line) || /^\[JKKP/.test(line) || /^PN\(PU2\)/.test(line)) break;
    if (/^\d+\.\s+/.test(line)) { flushItem(); const m = /^(\d+)\.\s+(.*)/.exec(line); currentItem = { num: m[1], text: m[2] }; continue; }
    if (/^[A-Z][A-Z\s,]+$/.test(line) && !/^\d/.test(line) && line.length > 4) { currentCategory = line; continue; }
    if (currentItem) currentItem.text += ' ' + line;
  }
  flushItem();
  return clauses;
}

function parseJadualKetiga(lines, jadualName) {
  const clauses = [];
  let currentCategory = null;
  let currentItem = null;
  let targetCol = 'col1';
  const flush = () => {
    if (currentItem) {
      const col1 = clean(currentItem.col1);
      const col2 = clean(currentItem.col2);
      const subLbl = currentItem.sub ? `(${currentItem.sub})` : '';
      const sectionNum = `Jadual ${jadualName}${currentCategory ? ` (${currentCategory})` : ''} Item ${currentItem.num}${subLbl}`;
      const text = col2
        ? `${currentItem.num}${subLbl}. ${col1} | ${col2}`
        : `${currentItem.num}${subLbl}. ${col1}`;
      clauses.push({ section_number: sectionNum, clause_text: text });
    }
    currentItem = null;
    targetCol = 'col1';
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^Ruang\s+\d/.test(line) || /^Perihal\s+/.test(line) || /^Jenis\s+aktiviti/.test(line)) continue;
    if (/^\[Peraturan/.test(line)) continue;
    if (/^Dibuat\s+/.test(line) || /^\[JKKP/.test(line) || /^PN\(PU2\)/.test(line)) break;
    if (/^(KERACUNAN|JANGKITAN|PENYAKIT KULIT|KEADAAN LAIN)\s*$/.test(line)) { flush(); currentCategory = line; continue; }
    const mItem = /^(\d+)\.\s+(.*)/.exec(line);
    if (mItem) {
      flush();
      const rest = mItem[2];
      const splitIdx = findColumnSplit(rest);
      currentItem = { num: mItem[1], sub: null, col1: splitIdx > 0 ? rest.substring(0, splitIdx) : rest, col2: splitIdx > 0 ? rest.substring(splitIdx) : '' };
      targetCol = currentItem.col2 ? 'col2' : 'col1';
      continue;
    }
    const mSub = /^\(([a-z]+)\)\s+(.*)/.exec(line);
    if (mSub && currentItem) {
      const rest = mSub[2];
      const splitIdx = findColumnSplit(rest);
      if (currentItem.sub && splitIdx <= 0 && mSub[1].length === 1) {
        currentItem.col2 += ` (${mSub[1]}) ${rest}`.replace(/\s+/g, ' ').trim();
        continue;
      }
      const parentNum = currentItem.num;
      const sub = mSub[1];
      if (splitIdx > 0 && mSub[1].length === 1) {
        flush();
        currentItem = { num: parentNum, sub, col1: rest.substring(0, splitIdx), col2: rest.substring(splitIdx) };
        targetCol = 'col2';
      } else if (mSub[1].length === 1) {
        flush();
        currentItem = { num: parentNum, sub, col1: rest, col2: '' };
        targetCol = 'col2';
      } else {
        if (currentItem[targetCol] !== undefined) currentItem[targetCol] += ' ' + rest;
      }
      continue;
    }
    if (mSub) continue;
    if (currentItem) {
      const splitIdx = findColumnSplit(line);
      if (splitIdx > 0) { currentItem.col1 += ' ' + line.substring(0, splitIdx); currentItem.col2 += ' ' + line.substring(splitIdx); targetCol = 'col2'; }
      else currentItem[targetCol] += ' ' + line;
    }
  }
  flush();
  return clauses;
}

async function getVectorEmbedding(text) {
  let retries = 3;
  while (retries > 0) {
    try {
      const response = await fetch(OPENROUTER_EMBED_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`
        },
        body: JSON.stringify({ model: EMBED_MODEL, input: text })
      });
      const data = await response.json();
      if (data.data && data.data[0] && data.data[0].embedding) return data.data[0].embedding;
      throw new Error('No embedding: ' + JSON.stringify(data).slice(0, 200));
    } catch (err) {
      console.warn(`⚠️ Embed retry (${retries} left): ${err.message}`);
      retries--;
      await delay(2000);
    }
  }
  return null;
}

function inferTrigger(sectionNumber) {
  if (sectionNumber.startsWith('Section 1')) return 'general definitions';
  if (sectionNumber.startsWith('Section 2')) return 'definitions and interpretation';
  if (sectionNumber.startsWith('Section 3')) return 'application and scope';
  if (sectionNumber.startsWith('Section 4')) return 'incident reporting exemption';
  if (sectionNumber.startsWith('Section 5')) return 'accident and dangerous occurrence notification';
  if (sectionNumber.startsWith('Section 6')) return 'self-employed reporting';
  if (sectionNumber.startsWith('Section 7')) return 'occupational poisoning and disease reporting';
  if (sectionNumber.startsWith('Section 8')) return 'self-employed disease reporting';
  if (sectionNumber.startsWith('Section 9')) return 'accident scene preservation';
  if (sectionNumber.startsWith('Section 10')) return 'record keeping';
  if (sectionNumber.startsWith('Section 11')) return 'incident information request';
  if (sectionNumber.startsWith('Section 12')) return 'schedule amendment';
  if (sectionNumber.startsWith('Section 13')) return 'penalty for non-compliance';
  if (sectionNumber.startsWith('Jadual Pertama')) return 'serious bodily injury classification';
  if (sectionNumber.startsWith('Jadual Kedua')) return 'dangerous occurrence classification';
  if (sectionNumber.startsWith('Jadual Ketiga')) return 'occupational poisoning and disease';
  if (sectionNumber.startsWith('Jadual Keempat')) return 'incident information request';
  return 'general safety';
}

function inferFrequency(sectionNumber, text) {
  if (/Section\s+2\(1\)/.test(sectionNumber)) return 'once';
  if (/Jadual/.test(sectionNumber)) return 'once';
  if (/sebelum 31 Januari|tempoh 12 bulan|setiap tahun/.test(text)) return 'annually';
  if (/dalam masa 7 hari|segera|secepat/.test(text)) return 'once';
  if (/menyenggara|merekod/.test(text)) return 'continuous';
  return 'continuous';
}

async function run() {
  console.log('🚀 Ingesting:', PDF_NAME);
  const text = extractText();

  const bodyStart = text.indexOf('PADA menjalankan kuasa');
  const jadualStart = text.indexOf('JADUAL PERTAMA');
  if (bodyStart === -1 || jadualStart === -1) {
    console.error('❌ Could not locate body or jadual sections');
    process.exit(1);
  }
  const peraturanText = text.substring(bodyStart, jadualStart);
  const jadualText = text.substring(jadualStart);

  console.log('🔍 Parsing Peraturan sections...');
  const sections = parsePeraturan(peraturanText);
  const allClauses = [];
  for (const s of sections) {
    console.log(`   Section ${s.number}${s.title ? ' — ' + s.title : ''}`);
    const c = parseSection(s);
    allClauses.push(...c);
  }
  console.log(`   → ${allClauses.length} peraturan clauses`);

  console.log('🔍 Parsing Jadual sections...');
  const jadualClauses = parseJadual(jadualText);
  allClauses.push(...jadualClauses);
  console.log(`   → ${jadualClauses.length} jadual clauses`);
  console.log(`📊 Total clauses: ${allClauses.length}`);

  console.log('\n📋 Sample clauses:');
  allClauses.slice(0, 8).forEach((c) => {
    console.log(`   [${c.section_number}] ${c.clause_text.slice(0, 100)}${c.clause_text.length > 100 ? '...' : ''}`);
  });

  console.log('\n💾 Checking if document already exists...');
  const { data: existing } = await supabase.from('documents').select('id').eq('name', PDF_NAME).limit(1);
  let docId;
  if (existing && existing.length > 0) {
    docId = existing[0].id;
    console.log(`   ⏭️ Document exists, ID: ${docId}. Replacing clauses.`);
    const { data: oldClauses } = await supabase.from('clauses').select('id').eq('doc_id', docId);
    if (oldClauses && oldClauses.length > 0) {
      const oldIds = oldClauses.map(c => c.id);
      await supabase.from('obligations').delete().in('clause_id', oldIds);
    }
    await supabase.from('clauses').delete().eq('doc_id', docId);
  } else {
    const { data: docRow, error: docError } = await supabase.from('documents').insert({
      name: PDF_NAME, type: DOC_TYPE, category_path: CATEGORY
    }).select().single();
    if (docError) { console.error('❌ Insert document failed:', docError.message); process.exit(1); }
    docId = docRow.id;
    console.log(`   ✅ Created document, ID: ${docId}`);
  }

  console.log('\n🧠 Generating embeddings & inserting...');
  let ok = 0, fail = 0;
  for (let i = 0; i < allClauses.length; i++) {
    const c = allClauses[i];
    const embedText = `${c.section_number}. ${c.clause_text}`;
    process.stdout.write(`   [${i + 1}/${allClauses.length}] ${c.section_number} ... `);
    const embedding = await getVectorEmbedding(embedText);
    if (!embedding) { console.log('❌ no embedding'); fail++; continue; }

    const { data: clauseRow, error: clauseError } = await supabase.from('clauses').insert({
      doc_id: docId,
      section_number: c.section_number,
      clause_text: c.clause_text,
      embedding,
      parent_citations: []
    }).select().single();
    if (clauseError) { console.log('❌', clauseError.message); fail++; continue; }

    const { error: oblError } = await supabase.from('obligations').insert({
      clause_id: clauseRow.id,
      trigger_activity: inferTrigger(c.section_number),
      required_action: c.clause_text,
      frequency: inferFrequency(c.section_number, c.clause_text),
      legal_weight: 'mandatory'
    });
    if (oblError) { console.log('⚠️ obligation:', oblError.message); fail++; }
    else { console.log('✅'); ok++; }
    await delay(300);
  }

  console.log(`\n🎉 Ingestion complete! ${ok} ok, ${fail} failed.`);
}

run();
