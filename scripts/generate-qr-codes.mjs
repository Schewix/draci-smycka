#!/usr/bin/env node

import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import SVGtoPDF from 'svg-to-pdfkit';

const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), 'scripts/.env'),
  path.resolve(process.cwd(), 'web/.env'),
  path.resolve(process.cwd(), 'web/.env.local'),
  path.resolve(process.cwd(), 'web/src/.env'),
  path.resolve(process.cwd(), 'web/src/.env.local'),
];

const loadedEnvFiles = [];
for (const candidate of envCandidates) {
  if (existsSync(candidate)) {
    const result = loadEnv({ path: candidate, override: false });
    if (!result.error) {
      loadedEnvFiles.push(candidate);
    }
  }
}

if (loadedEnvFiles.length) {
  console.log(`Loaded environment variables from: ${loadedEnvFiles.join(', ')}`);
}

if (!process.env.SUPABASE_URL && process.env.VITE_SUPABASE_URL) {
  process.env.SUPABASE_URL = process.env.VITE_SUPABASE_URL;
}

if (!process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_SERVICE_KEY) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY;
}

if (!process.env.SUPABASE_ANON_KEY && process.env.VITE_SUPABASE_ANON_KEY) {
  process.env.SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;
}

function printUsageAndExit() {
  console.error('Usage: node scripts/generate-qr-codes.mjs <EVENT_ID> [output-directory]');
  process.exit(1);
}

const [, , eventId, outputDirArg] = process.argv;

if (!eventId) {
  console.error('Missing required <EVENT_ID> argument.');
  printUsageAndExit();
}

const supabaseUrl = process.env.SUPABASE_URL?.trim();
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_ANON_KEY ||
  process.env.SUPABASE_KEY;

if (!supabaseUrl) {
  console.error('Environment variable SUPABASE_URL is required.');
  process.exit(1);
}

if (!supabaseKey) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY) so the script can query Supabase.');
  process.exit(1);
}

const normalizedUrl = supabaseUrl.endsWith('/') ? supabaseUrl : `${supabaseUrl}/`;

const eventUrl = new URL('rest/v1/events', normalizedUrl);
eventUrl.searchParams.set('select', 'id,name,base_path');
eventUrl.searchParams.set('id', `eq.${eventId}`);
eventUrl.searchParams.set('limit', '1');

const competitorsUrl = new URL('rest/v1/competitors', normalizedUrl);
competitorsUrl.searchParams.set('select', 'id,display_name,start_number,category_code,qr_token');
competitorsUrl.searchParams.set('event_id', `eq.${eventId}`);
competitorsUrl.searchParams.set('order', 'start_number');

const outputDir = path.resolve(process.cwd(), outputDirArg ?? path.join('qr-codes', eventId));

try {
  const eventResponse = await fetch(eventUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });

  if (!eventResponse.ok) {
    const errorText = await eventResponse.text();
    throw new Error(`Failed to fetch event: ${eventResponse.status} ${eventResponse.statusText}\n${errorText}`);
  }

  const [event] = await eventResponse.json();

  if (!event) {
    console.error(`Event with ID ${eventId} not found.`);
    process.exit(1);
  }

  const response = await fetch(competitorsUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch patrols: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const competitors = await response.json();

  if (!Array.isArray(competitors) || competitors.length === 0) {
    console.warn('No competitors found for the provided event ID.');
    process.exit(0);
  }

  await mkdir(outputDir, { recursive: true });

  let generatedCount = 0;
  const labeledSvgs = [];
  const baseDomain = (process.env.QR_BASE_DOMAIN ?? 'https://zelenaliga.cz').replace(/\/$/, '');
  const basePath = typeof event.base_path === 'string' && event.base_path.length > 0 ? event.base_path : '/draci-smycka';

  for (const competitor of competitors) {
    const { id, display_name: displayName, start_number: startNumber, qr_token: qrToken } = competitor;
    const token = typeof qrToken === 'string' ? qrToken.trim() : '';

    if (!token) {
      console.warn(`Skipping competitor ${displayName ?? id ?? '<unknown>'} because qr_token is missing.`);
      continue;
    }

    const pathPart = basePath.startsWith('/') ? basePath : `/${basePath}`;
    const payloadUrl = `${baseDomain}${pathPart}?t=${encodeURIComponent(token)}`;

    const payload = payloadUrl;
    const baseSvg = await QRCode.toString(payload, {
      type: 'svg',
      errorCorrectionLevel: 'M',
      margin: 2,
    });

    const labelParts = [startNumber != null ? `#${startNumber}` : null, displayName ?? ''];
    const label = labelParts.filter((part) => part && String(part).trim().length > 0).join(' ');
    const labeledSvg = addLabel(baseSvg, label || token);
    const fileName = `${sanitizeFileName(label || token)}.svg`;
    await writeFile(path.join(outputDir, fileName), labeledSvg.svg, 'utf8');
    labeledSvgs.push(labeledSvg);
    generatedCount += 1;
    console.log(`Generated ${fileName}`);
  }

  console.log(`\nCreated ${generatedCount} QR code file(s) in ${outputDir}`);

  if (labeledSvgs.length > 0) {
    const pdfPath = path.join(outputDir, 'qr-codes.pdf');
    await createPdf(labeledSvgs, pdfPath);
    console.log(`Created PDF with QR codes: ${pdfPath}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

function addLabel(baseSvg, label) {
  const openingTagMatch = baseSvg.match(/^<svg[^>]*>/);
  if (!openingTagMatch) {
    throw new Error('Unexpected QR SVG output.');
  }

  const openingTag = openingTagMatch[0];
  const viewBoxMatch = openingTag.match(/viewBox="0 0 ([^\s"]+) ([^\s"]+)"/);

  const qrWidth = viewBoxMatch ? Number.parseFloat(viewBoxMatch[1]) : Number.NaN;
  const qrHeight = viewBoxMatch ? Number.parseFloat(viewBoxMatch[2]) : qrWidth;

  if (!Number.isFinite(qrWidth) || !Number.isFinite(qrHeight)) {
    throw new Error('Unable to determine QR dimensions from SVG.');
  }

  const originalWidthAttr = extractAttribute(openingTag, 'width');
  const originalHeightAttr = extractAttribute(openingTag, 'height');

  const qrBody = baseSvg.slice(openingTag.length, baseSvg.lastIndexOf('</svg>'));

  const labelSpace = qrHeight * 0.3;
  const totalHeight = qrHeight + labelSpace;
  const fontSize = labelSpace * 0.5;
  const labelY = qrHeight + labelSpace * 0.75;

  const widthAttr = originalWidthAttr ? ` width="${originalWidthAttr}"` : '';
  const heightAttrValue = computeScaledDimension(
    originalHeightAttr || originalWidthAttr,
    totalHeight / qrHeight,
  );
  const heightAttr = heightAttrValue ? ` height="${heightAttrValue}"` : '';

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${qrWidth} ${totalHeight}"${widthAttr}${heightAttr}>` +
    `<g shape-rendering="crispEdges">${qrBody}</g>` +
    `<text x="${qrWidth / 2}" y="${labelY}" text-anchor="middle" font-family="sans-serif" font-size="${fontSize}" fill="#000">${escapeXml(
      label,
    )}</text>` +
    '</svg>';

  return {
    svg,
    viewBoxWidth: qrWidth,
    viewBoxHeight: totalHeight,
  };
}

function extractAttribute(openingTag, attribute) {
  const match = openingTag.match(new RegExp(`${attribute}="([^"]+)"`));
  return match ? match[1] : undefined;
}

function computeScaledDimension(dimension, scale) {
  if (!dimension) {
    return undefined;
  }

  const numeric = Number.parseFloat(dimension);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const unit = dimension.replace(/[0-9.+-]/g, '');
  const scaled = numeric * scale;
  const rounded = Number.isInteger(scaled) ? scaled : Number(scaled.toFixed(2));
  return `${rounded}${unit}`;
}

async function createPdf(labeledSvgs, outputPath) {
  const doc = new PDFDocument({ size: 'A4', margin: cmToPt(1) });
  const stream = createWriteStream(outputPath);

  const qrWidthPt = cmToPt(6);
  const gapPt = cmToPt(0.4);
  const aspectRatios = labeledSvgs.map((svg) => svg.viewBoxHeight / svg.viewBoxWidth);
  const maxAspectRatio = Math.max(...aspectRatios);
  if (!Number.isFinite(maxAspectRatio)) {
    throw new Error('Unable to determine QR aspect ratio for PDF export.');
  }
  const maxHeightPt = qrWidthPt * maxAspectRatio;

  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const usableHeight = doc.page.height - doc.page.margins.top - doc.page.margins.bottom;

  const columns = Math.max(1, Math.floor((usableWidth + gapPt) / (qrWidthPt + gapPt)));
  const rows = Math.max(1, Math.floor((usableHeight + gapPt) / (maxHeightPt + gapPt)));

  doc.pipe(stream);

  let column = 0;
  let row = 0;
  const slotWidth = qrWidthPt + gapPt;
  const slotHeight = maxHeightPt + gapPt;
  const marginLeft = doc.page.margins.left;
  const marginTop = doc.page.margins.top;

  labeledSvgs.forEach((svg, index) => {
    const aspectRatio = aspectRatios[index];

    if (row >= rows) {
      doc.addPage();
      row = 0;
      column = 0;
    }

    const currentMarginLeft = doc.page.margins.left ?? marginLeft;
    const currentMarginTop = doc.page.margins.top ?? marginTop;

    const x = currentMarginLeft + column * slotWidth;
    const y = currentMarginTop + row * slotHeight;

    const targetHeight = qrWidthPt * aspectRatio;
    const yOffset = y + (maxHeightPt - targetHeight) / 2;

    SVGtoPDF(doc, svg.svg, x, yOffset, {
      width: qrWidthPt,
      height: targetHeight,
      preserveAspectRatio: 'xMidYMid meet',
    });

    column += 1;
    if (column >= columns) {
      column = 0;
      row += 1;
    }
  });

  return new Promise((resolve, reject) => {
    stream.on('finish', resolve);
    stream.on('error', reject);
    doc.on('error', reject);
    doc.end();
  });
}

function cmToPt(centimeters) {
  return (centimeters / 2.54) * 72;
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function sanitizeFileName(value) {
  return value.replace(/[^\p{L}\p{N}_.-]+/gu, '_');
}
