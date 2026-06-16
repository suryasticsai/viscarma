function trySimpleFix(prompt, sourceFiles) {
  const changes = [];

  // More flexible regex: duplicate + (declaration|definition|variable) + optional "of" + variable name
  const duplicateMatch = prompt.match(/duplicate\s+(?:declaration|definition|variable)\s+(?:of\s+)?['"]?(\w+)['"]?/i);
  if (duplicateMatch) {
    const varName = duplicateMatch[1];
    console.log(`🔎 Rule check: looking for duplicate '${varName}'`);

    for (const [filePath, content] of Object.entries(sourceFiles)) {
      if (!filePath.endsWith('.js') && !filePath.endsWith('.html')) continue;

      const lines = content.split('\n');
      const declarations = [];

      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (
          (trimmed.startsWith('let ') || trimmed.startsWith('const ') || trimmed.startsWith('var ')) &&
          trimmed.includes(varName) &&
          (trimmed.includes('=') || trimmed.includes(';'))  // ensure it's a declaration statement
        ) {
          declarations.push({ line: trimmed, index: idx });
        }
      });

      console.log(`   Found ${declarations.length} declaration(s) in ${filePath}`);
      declarations.forEach(d => console.log(`      Line ${d.index + 1}: ${d.line}`));

      if (declarations.length >= 2) {
        // Remove the first declaration (keep the second one)
        const originalLine = lines[declarations[0].index];
        changes.push({
          file: filePath,
          oldLine: originalLine,
          newLine: ''
        });
        console.log(`✅ Rule‑based fix: removing first duplicate of '${varName}' at line ${declarations[0].index + 1}`);
        return changes;
      }
    }
  } else {
    console.log('🔎 No duplicate declaration phrase found in prompt.');
  }

  return null;
}

module.exports = { trySimpleFix };