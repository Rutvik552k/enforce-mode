#!/usr/bin/env node
/**
 * enforce-anchor.js — local CLAUDE.md anchor detection
 *
 * The "anchor" is a managed block inside the working directory's CLAUDE.md
 * that the MAIN agent writes via `/enforce init "<goal>"`. It stores the
 * goal, detected tech stack, requirements, and the task list — an anti-drift
 * reference the main agent re-reads to stay on track across the SDLC loop.
 *
 * This module is read-only detection. Generation/merge is performed by the
 * main agent (driven by the enforce-init command prompt), never by a hook —
 * hooks must not silently rewrite a user's CLAUDE.md.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ANCHOR_START = '<!-- enforce-anchor:start -->';
const ANCHOR_END = '<!-- enforce-anchor:end -->';

/**
 * @param {string} cwd
 * @returns {string} Absolute path to the working-directory CLAUDE.md
 */
function anchorPath(cwd) {
  return path.join(cwd, 'CLAUDE.md');
}

/**
 * Does the local CLAUDE.md contain a managed enforce anchor block?
 * @param {string} cwd
 * @returns {boolean}
 */
function hasAnchor(cwd) {
  try {
    const content = fs.readFileSync(anchorPath(cwd), 'utf8');
    return content.includes(ANCHOR_START) && content.includes(ANCHOR_END);
  } catch {
    return false;
  }
}

/**
 * Extract the anchor block content (between markers), or null.
 * @param {string} cwd
 * @returns {string|null}
 */
function readAnchor(cwd) {
  try {
    const content = fs.readFileSync(anchorPath(cwd), 'utf8');
    const s = content.indexOf(ANCHOR_START);
    const e = content.indexOf(ANCHOR_END);
    if (s === -1 || e === -1 || e < s) return null;
    return content.slice(s + ANCHOR_START.length, e).trim();
  } catch {
    return null;
  }
}

module.exports = { ANCHOR_START, ANCHOR_END, anchorPath, hasAnchor, readAnchor };
