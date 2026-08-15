const fs = require('fs');
const filePath = 'C:\\Users\\Lylo\\Documents\\petroshield-chat\\client\\src\\components\\ChatArea.tsx';
const content = fs.readFileSync(filePath, 'utf8');

// Replace smart quotes (the garbled pattern)
const fixed = content.replace(/A��'A,A�A�A�A��,���A,A�A�A�A��\?sA�A,A\?/g, '"');
fs.writeFileSync(filePath, fixed, 'utf8');
console.log('Done fixing smart quotes');