import {remark} from 'remark';
import {visit} from 'unist-util-visit';
import type {Position} from 'unist';
import {load, dump} from 'js-yaml';
import remarkGfm from 'remark-gfm';

// Useful regexes

export const headerRegex = /^(\s*)(#+)(\s+)(.*)$/;
export const fencedRegexTemplate = '^XXX\\.*?\n(?:((?:.|\n)*?)\n)?XXX(?=\\s|$)$';
export const yamlRegex = /^---\n((?:(((?!---)(?:.|\n)*?)\n)?))---(?=\n|$)/;
export const backtickBlockRegexTemplate = fencedRegexTemplate.replaceAll('X', '`');
export const tildeBlockRegexTemplate = fencedRegexTemplate.replaceAll('X', '~');
export const indentedBlockRegex = '^((\t|( {4})).*\n)+';
export const codeBlockRegex = new RegExp(`${backtickBlockRegexTemplate}|${tildeBlockRegexTemplate}|${indentedBlockRegex}`, 'gm');
export const linkRegex = /((!?)\[.*\]\(.*\))|(\[{2}.*\]{2})/g;

// Helper functions

/**
 * Gets the positions of the given element type in the given text.
 * @param {string} type The element type to get positions for
 * @param {string} text The markdown text
 * @return {Position[]} The positions of the given element type in the given text
 */
function getPositions(type: string, text: string) {
  const ast = remark().use(remarkGfm).parse(text);
  const positions: Position[] = [];
  visit(ast, type, (node) => {
    positions.push(node.position);
  });

  // Sort positions by start position in reverse order
  positions.sort((a, b) => b.start.offset - a.start.offset);
  return positions;
}

/**
 * Replaces all codeblocks in the given text with a placeholder.
 * @param {string} text The text to replace codeblocks in
 * @param {string} placeholder The placeholder to use
 * @return {string} The text with codeblocks replaced, and the list of codeblocks
 * @return {string[]} The codeblocks replaced
 */
function replaceCodeblocks(text: string, placeholder: string): {text: string, replacedCodeBlocks: string[]} {
  const positions: Position[] = getPositions('code', text);
  const replacedCodeBlocks: string[] = [];

  for (const position of positions) {
    const codeblock = text.substring(position.start.offset, position.end.offset);
    replacedCodeBlocks.push(codeblock);
    text = text.substring(0, position.start.offset) + placeholder + text.substring(position.end.offset);
  }

  // Reverse the codeblocks so that they are in the same order as the original text
  replacedCodeBlocks.reverse();

  return {text, replacedCodeBlocks};
}

/**
 * Makes sure that the style of either strong or emphasis is consistent.
 * @param {string} text The text to style either the strong or emphasis in a consistent manner
 * @param {string} style The style to use for the emphasis indicator (i.e. underscore, asterisk, or consistent)
 * @param {string} type The type of element to make consistent and the value should be either strong or emphasis
 * @return {string} The text with either strong or emphasis styles made consistent
 */
export function makeEmphasisOrBoldConsistent(text: string, style: string, type: string): string {
  const positions: Position[] = getPositions(type, text);
  if (positions.length === 0) {
    return text;
  }

  let indicator = '';
  if (style === 'underscore') {
    indicator = '_';
  } else if (style === 'asterisk') {
    indicator = '*';
  } else {
    const firstPosition = positions[positions.length-1];
    indicator = text.substring(firstPosition.start.offset, firstPosition.start.offset+1);
  }

  // make the size two for the indicator when the type is strong
  if (type === 'strong') {
    indicator += indicator;
  }

  for (const position of positions) {
    text = text.substring(0, position.start.offset) + indicator + text.substring(position.start.offset + indicator.length, position.end.offset - indicator.length) + indicator + text.substring(position.end.offset);
  }

  return text;
}

/**
 * Moves footnote declarations to the end of the document.
 * @param {string} text The text to move footnotes in
 * @return {string} The text with footnote declarations moved to the end
 */
export function moveFootnotesToEnd(text: string) {
  const positions: Position[] = getPositions('footnoteDefinition', text);
  const footnotes: string[] = [];

  for (const position of positions) {
    const footnote = text.substring(position.start.offset, position.end.offset);
    footnotes.push(footnote);
    // Remove the newline after the footnote if it exists
    if (position.end.offset < text.length && text[position.end.offset] === '\n') {
      text = text.substring(0, position.end.offset) + text.substring(position.end.offset + 1);
    }
    // Remove the newline after the footnote if it exists
    if (position.end.offset < text.length && text[position.end.offset] === '\n') {
      text = text.substring(0, position.end.offset) + text.substring(position.end.offset + 1);
    }
    text = text.substring(0, position.start.offset) + text.substring(position.end.offset);
  }

  // Reverse the footnotes so that they are in the same order as the original text
  footnotes.reverse();

  // Add the footnotes to the end of the document
  if (footnotes.length > 0) {
    text = text.trimEnd() + '\n';
  }
  for (const footnote of footnotes) {
    text += '\n' + footnote;
  }

  return text;
}

/**
 * Substitutes YAML, links, and codeblocks in a text with a placeholder.
 * Then applies the given function to the text.
 * Substitutes the YAML and codeblocks back to their original form.
 * @param {string} text - The text to process
 * @param {function(string): string} func - The function to apply to the text
 * @return {string} The processed text
 */
export function ignoreCodeBlocksYAMLAndLinks(text: string, func: (text: string) => string): string {
  const codePlaceholder = 'PLACEHOLDER 321417';
  const ret = replaceCodeblocks(text, codePlaceholder);
  text = ret.text;
  const replacedCodeBlocks = ret.replacedCodeBlocks;

  const yamlPlaceholder = '---\n---';
  const yamlMatches = text.match(yamlRegex);
  if (yamlMatches) {
    text = text.replace(yamlMatches[0], escapeDollarSigns(yamlPlaceholder));
  }

  const linkPlaceHolder = 'PLACEHOLDER_LINK 57849';
  const linkMatches = text.match(linkRegex);
  text = text.replaceAll(linkRegex, linkPlaceHolder);

  text = func(text);

  if (linkMatches) {
    for (const link of linkMatches) {
      // Regex was added to fix capitalization issue  where another rule made the text not match the original place holder's case
      // see https://github.com/platers/obsidian-linter/issues/201
      text = text.replace(new RegExp(linkPlaceHolder, 'i'), link);
    }
  }

  if (yamlMatches) {
    text = text.replace(yamlPlaceholder, escapeDollarSigns(yamlMatches[0]));
  }

  for (const codeblock of replacedCodeBlocks) {
    text = text.replace(codePlaceholder, escapeDollarSigns(codeblock));
  }

  return text;
}

export function formatYAML(text: string, func: (text: string) => string): string {
  if (!text.match(yamlRegex)) {
    return text;
  }

  const oldYaml = text.match(yamlRegex)[0];
  const newYaml = func(oldYaml);
  text = text.replace(oldYaml, escapeDollarSigns(newYaml));

  return text;
}


/**
 * Adds an empty YAML block to the text if it doesn't already have one.
 * @param {string} text - The text to process
 * @return {string} The processed text with an YAML block
 */
export function initYAML(text: string): string {
  if (text.match(yamlRegex) === null) {
    text = '---\n---\n' + text;
  }
  return text;
}

/**
 * Inserts a string at the given position in a string.
 * @param {string} str - The string to insert into
 * @param {number} index - The position to insert at
 * @param {string} value - The string to insert
 * @return {string} The string with the inserted string
 */
export function insert(str: string, index: number, value: string): string {
  return str.substr(0, index) + value + str.substr(index);
}

// https://stackoverflow.com/questions/38866071/javascript-replace-method-dollar-signs
// Important to use this for any regex replacements where the replacement string
// could have user constructed dollar signs in it
export function escapeDollarSigns(str: string): string {
  return str.replace(/\$/g, '$$$$');
}

// https://stackoverflow.com/questions/3446170/escape-string-for-use-in-javascript-regex
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}

/**
 * Replaces \r with nothing.
 * @param {string} text - Text to strip
 * @return {string} Stripped text
 */
export function stripCr(text: string): string {
  return text.replace(/\r/g, '');
}

export function loadYAML(yaml_text: string): any {
  // replacing tabs at the beginning of new lines with 2 spaces fixes loading yaml that has tabs at the start of a line
  // https://github.com/platers/obsidian-linter/issues/157
  const parsed_yaml = load(yaml_text.replace(/\n(\t)+/g, '\n  ')) as {};
  if (!parsed_yaml) {
    return {};
  }
  return parsed_yaml;
}

export function escapeYamlString(str: string): string {
  return dump(str, {lineWidth: -1}).slice(0, -1);
}
