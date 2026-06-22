const fs = require('fs');
const xml = fs.readFileSync('./PEGSUPMST.xml', 'utf8');
const linkXml = fs.readFileSync('./PEGLINK.xml', 'utf8');

// Find all N-type supplies
const nSupplies = new Set();
const nMatches = xml.match(/<Record[\s\S]*?<\/Record>/g) || [];
nMatches.forEach(r => {
  if (r.includes('<PegSupMst_SupplyType>N</PegSupMst_SupplyType>')) {
    const seq = r.match(/<PegSupMst_SupplySeq>([^<]*)<\/PegSupMst_SupplySeq>/);
    if (seq) nSupplies.add(seq[1]);
  }
});

console.log('N-type supplies found:', nSupplies.size);

// Check how many N-type supplies are referenced in PEGLINK
const linkMatches = linkXml.match(/<Record[\s\S]*?<\/Record>/g) || [];
let nLinksCount = 0;
linkMatches.forEach(r => {
  const supSeq = r.match(/<PegLink_SupplySeq>([^<]*)<\/PegLink_SupplySeq>/);
  if (supSeq && nSupplies.has(supSeq[1])) {
    nLinksCount++;
  }
});

console.log('N-type supplies in PEGLINK:', nLinksCount);
console.log('Sample N-type supply seqs:', Array.from(nSupplies).slice(0, 5));
